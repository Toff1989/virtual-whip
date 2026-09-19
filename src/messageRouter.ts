import * as vscode from 'vscode';

export type WhipTarget = 'auto' | 'claude' | 'copilot';
export type ReasoningEffort = 'unchanged' | 'low' | 'medium' | 'high';

export interface SendOptions {
    target: WhipTarget;
    /** Interrupts the ongoing work before sending (instead of queuing the message). */
    interrupt: boolean;
    interruptDelayMs: number;
    reasoningEffort: ReasoningEffort;
}

// A "claude" command started in a terminal (claude, claude.exe, claude --resume, ...).
const CLAUDE_COMMAND = /(^|[\s"'\\/])claude(\.exe|\.cmd|\.ps1)?(\s|$|["'])/i;
const ESCAPE = '\x1b';
// Two Escapes in quick succession trigger "clear / rewind" in Claude Code: space them out.
const MIN_ESCAPE_GAP_MS = 1500;
// Claude Code treats a "text + Enter" block received at once as a paste: send them separately.
const SUBMIT_DELAY_MS = 120;
const EFFORT_SETTLE_MS = 500;
const HINT_THROTTLE_MS = 30_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends the whip's messages to the right place, without ever touching the focus:
 *  - Claude Code terminal: `sendText` needs no focus (no `terminal.show`);
 *  - Copilot chat: internal command `workbench.action.chat.submit` with `preserveFocus`
 *    (unlike `workbench.action.chat.open`, which steals the focus and queues the message).
 */
export class MessageRouter implements vscode.Disposable {
    private readonly claudeTerminals = new Set<vscode.Terminal>();
    private lastClaudeTerminal: vscode.Terminal | undefined;
    private readonly lastEscape = new WeakMap<vscode.Terminal, number>();
    private readonly appliedEffort = new WeakMap<vscode.Terminal, string>();
    private readonly disposables: vscode.Disposable[] = [];
    private pending: Promise<void> = Promise.resolve();
    private lastHint = 0;
    private warnedCopilotEffort = false;

    constructor(private readonly output: vscode.OutputChannel) {
        this.disposables.push(
            vscode.window.onDidStartTerminalShellExecution((event) => {
                if (CLAUDE_COMMAND.test(event.execution.commandLine.value)) {
                    this.claudeTerminals.add(event.terminal);
                    this.lastClaudeTerminal = event.terminal;
                    this.output.appendLine(`[router] Claude Code detected in terminal "${event.terminal.name}"`);
                }
            }),
            vscode.window.onDidEndTerminalShellExecution((event) => {
                if (this.claudeTerminals.delete(event.terminal)) {
                    this.appliedEffort.delete(event.terminal);
                }
            }),
            vscode.window.onDidCloseTerminal((terminal) => {
                this.claudeTerminals.delete(terminal);
                if (this.lastClaudeTerminal === terminal) {
                    this.lastClaudeTerminal = undefined;
                }
            })
        );
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    /** Sends are serialized so that Escape / message sequences never interleave. */
    send(message: string, options: SendOptions): void {
        this.pending = this.pending
            .then(() => this.dispatch(message, options))
            .catch((error: unknown) => {
                const detail = error instanceof Error ? error.message : String(error);
                this.output.appendLine(`[router] send failed: ${detail}`);
            });
    }

    private isClaudeTerminal(terminal: vscode.Terminal): boolean {
        return this.claudeTerminals.has(terminal) || /claude/i.test(terminal.name);
    }

    private pickTerminal(target: WhipTarget): vscode.Terminal | undefined {
        if (target === 'copilot') {
            return undefined;
        }
        const active = vscode.window.activeTerminal;
        if (active && this.isClaudeTerminal(active)) {
            return active;
        }
        if (this.lastClaudeTerminal && this.lastClaudeTerminal.exitStatus === undefined) {
            return this.lastClaudeTerminal;
        }
        const other = vscode.window.terminals.find((t) => this.isClaudeTerminal(t));
        if (other) {
            return other;
        }
        // Explicit "claude" choice: without detection, the active terminal is trusted.
        return target === 'claude' ? active : undefined;
    }

    private async dispatch(message: string, options: SendOptions): Promise<void> {
        const terminal = this.pickTerminal(options.target);
        if (terminal) {
            await this.sendToTerminal(terminal, message, options);
            return;
        }
        if (options.target === 'claude') {
            this.output.appendLine('[router] target=claude but no terminal is available');
            this.hint(vscode.l10n.t('Virtual Whip: no Claude Code terminal found. Start `claude` in a VS Code terminal.'));
            return;
        }
        await this.sendToCopilot(message, options);
    }

    private async sendToTerminal(terminal: vscode.Terminal, message: string, options: SendOptions): Promise<void> {
        this.lastClaudeTerminal = terminal;
        this.output.appendLine(`[router] -> terminal "${terminal.name}"${options.interrupt ? ' (interrupt)' : ''}`);

        if (options.interrupt) {
            const sinceLast = Date.now() - (this.lastEscape.get(terminal) ?? 0);
            if (sinceLast >= MIN_ESCAPE_GAP_MS) {
                // Escape interrupts the ongoing turn (no effect when Claude is idle); without it,
                // the message would be queued until the end of the turn.
                terminal.sendText(ESCAPE, false);
                this.lastEscape.set(terminal, Date.now());
                await sleep(options.interruptDelayMs);
            }
        }

        if (options.reasoningEffort !== 'unchanged' && this.appliedEffort.get(terminal) !== options.reasoningEffort) {
            this.output.appendLine(`[router] /effort ${options.reasoningEffort}`);
            await this.typeLine(terminal, `/effort ${options.reasoningEffort}`);
            this.appliedEffort.set(terminal, options.reasoningEffort);
            await sleep(EFFORT_SETTLE_MS);
        }

        await this.typeLine(terminal, message);
    }

    private async typeLine(terminal: vscode.Terminal, text: string): Promise<void> {
        terminal.sendText(text, false);
        await sleep(SUBMIT_DELAY_MS);
        terminal.sendText('', true); // Enter alone
    }

    private async sendToCopilot(message: string, options: SendOptions): Promise<void> {
        this.output.appendLine(`[router] -> Copilot Chat${options.interrupt ? ' (stop and send)' : ''}`);
        if (options.reasoningEffort !== 'unchanged' && !this.warnedCopilotEffort) {
            this.warnedCopilotEffort = true;
            this.output.appendLine('[router] virtualWhip.reasoningEffort is not applied to Copilot Chat (no public API).');
        }
        // `inputValue` replaces the content of the input box; `preserveInput` and `preserveFocus`
        // leave the user's draft and the focus untouched; `cancelCurrentRequest` = "stop and
        // send" (otherwise the request would be queued).
        await vscode.commands.executeCommand('workbench.action.chat.submit', {
            inputValue: message,
            acceptInputOptions: {
                cancelCurrentRequest: options.interrupt,
                preserveFocus: true,
                preserveInput: true
            }
        });
    }

    private hint(text: string): void {
        const now = Date.now();
        if (now - this.lastHint < HINT_THROTTLE_MS) {
            return;
        }
        this.lastHint = now;
        void vscode.window.showInformationMessage(text);
    }
}
