import * as vscode from 'vscode';

export type WhipTarget = 'auto' | 'claude' | 'copilot';
export type ReasoningEffort = 'unchanged' | 'low' | 'medium' | 'high';

export interface SendOptions {
    target: WhipTarget;
    /** Interrupts the ongoing work before sending (instead of queuing the message). */
    interrupt: boolean;
    interruptDelayMs: number;
    reasoningEffort: ReasoningEffort;
    /** Claude Code terminal: sets the user's unsent draft aside while the message goes through. */
    preserveDraft: boolean;
}

/** Time source of the router (replaced in the tests, which must not wait for real delays). */
export interface RouterClock {
    sleep(ms: number): Promise<void>;
    now(): number;
}

const systemClock: RouterClock = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
};

// A "claude" command started in a terminal (claude, claude.exe, claude --resume, ...).
const CLAUDE_COMMAND = /(^|[\s"'\\/])claude(\.exe|\.cmd|\.ps1)?(\s|$|["'])/i;
const ESCAPE = '\x1b';
// Claude Code's line-editing keys, used to set the user's draft aside (see stashDraft).
const CTRL_E = '\x05'; // end of line
const CTRL_U = '\x15'; // delete up to the start of the line, into the paste buffer
const CTRL_Y = '\x19'; // paste what was deleted last
const BACKSPACE = '\x7f';
// Typed after the draft so that the paste buffer always holds something fresh, even when the
// draft is empty. '!', '/', '@' and '#' are special at the start of Claude Code's prompt: avoid them.
const DRAFT_MARKER = '~';
const KEY_GAP_MS = 40;
const DRAFT_RESTORE_DELAY_MS = 400;
// Two Escapes in quick succession trigger "clear / rewind" in Claude Code: space them out.
const MIN_ESCAPE_GAP_MS = 1500;
// Claude Code treats a "text + Enter" block received at once as a paste: send them separately.
const SUBMIT_DELAY_MS = 120;
const EFFORT_SETTLE_MS = 500;
const HINT_THROTTLE_MS = 30_000;

const CHAT_SUBMIT_COMMAND = 'workbench.action.chat.submit';
const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
const COPILOT_CHAT_EXTENSION_ID = 'GitHub.copilot-chat';

/**
 * Sends the whip's messages to the right place, without ever touching the focus:
 *  - Claude Code terminal: `sendText` needs no focus (no `terminal.show`);
 *  - Copilot chat: internal command `workbench.action.chat.submit` with `preserveInput`
 *    (unlike `workbench.action.chat.open`, which steals the focus and queues the message).
 */
export class MessageRouter implements vscode.Disposable {
    private readonly claudeTerminals = new Set<vscode.Terminal>();
    /** Terminals the user marked as Claude Code terminals (command "Use This Terminal for Claude Code"). */
    private readonly markedTerminals = new Set<vscode.Terminal>();
    private lastClaudeTerminal: vscode.Terminal | undefined;
    private readonly lastEscape = new WeakMap<vscode.Terminal, number>();
    private readonly appliedEffort = new WeakMap<vscode.Terminal, string>();
    private readonly disposables: vscode.Disposable[] = [];
    private pending: Promise<void> = Promise.resolve();
    private lastHint = 0;
    private readonly hintedOnce = new Set<string>();
    private warnedCopilotEffort = false;

    constructor(private readonly output: vscode.OutputChannel, private readonly clock: RouterClock = systemClock) {
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
                this.markedTerminals.delete(terminal);
                if (this.lastClaudeTerminal === terminal) {
                    this.lastClaudeTerminal = undefined;
                }
            })
        );
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    /**
     * Marks (or unmarks) a terminal as a Claude Code terminal. Automatic detection relies on the
     * shell integration of VS Code, which does not exist for every shell (cmd.exe, for one).
     * Returns true when the terminal is marked afterwards.
     */
    toggleMarkedTerminal(terminal: vscode.Terminal): boolean {
        if (this.markedTerminals.delete(terminal)) {
            // "Last used" must not keep the terminal a target once the user has said it is not one.
            if (this.lastClaudeTerminal === terminal) {
                this.lastClaudeTerminal = undefined;
            }
            this.output.appendLine(`[router] terminal "${terminal.name}" no longer marked as Claude Code`);
            return false;
        }
        this.markedTerminals.add(terminal);
        this.lastClaudeTerminal = terminal;
        this.output.appendLine(`[router] terminal "${terminal.name}" marked as Claude Code`);
        return true;
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

    /** Resolves when every send requested so far is done (tests). */
    idle(): Promise<void> {
        return this.pending;
    }

    /** What the router sees, as lines of text: the first thing to read when a message does not arrive. */
    async diagnose(target: WhipTarget): Promise<string[]> {
        const lines: string[] = [`VS Code ${vscode.version}`, `virtualWhip.target = ${target}`];

        const terminals = vscode.window.terminals;
        lines.push(`Terminals: ${terminals.length}`);
        for (const terminal of terminals) {
            const how = this.markedTerminals.has(terminal)
                ? 'marked by hand'
                : this.claudeTerminals.has(terminal)
                    ? 'detected (claude command)'
                    : /claude/i.test(terminal.name)
                        ? 'detected (name)'
                        : 'not Claude Code';
            const integration = terminal.shellIntegration ? 'shell integration on' : 'NO shell integration';
            lines.push(`  - "${terminal.name}": ${how}, ${integration}`);
        }

        const commands = await vscode.commands.getCommands(true);
        lines.push(`Command ${CHAT_SUBMIT_COMMAND}: ${commands.includes(CHAT_SUBMIT_COMMAND) ? 'available' : 'MISSING'}`);
        lines.push(`Copilot Chat extension: ${vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID) ? 'installed' : 'not installed'}`);
        lines.push(
            vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)
                ? `Claude Code extension: installed, chat panel ${this.claudePanelInUse() ? 'in use (cannot receive messages)' : 'off (terminal mode)'}`
                : 'Claude Code extension: not installed'
        );

        const terminal = this.pickTerminal(target);
        lines.push(
            `A crack would go to: ${terminal ? `terminal "${terminal.name}"` : target === 'claude' ? 'nowhere (no terminal)' : 'Copilot chat'}`
        );
        return lines;
    }

    private isClaudeTerminal(terminal: vscode.Terminal): boolean {
        return this.markedTerminals.has(terminal) || this.claudeTerminals.has(terminal) || /claude/i.test(terminal.name);
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

    /** True when the Claude Code extension is installed and shows its chat panel (which cannot be driven). */
    private claudePanelInUse(): boolean {
        if (!vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)) {
            return false;
        }
        return !vscode.workspace.getConfiguration('claudeCode').get<boolean>('useTerminal', false);
    }

    private panelHint(): string {
        return vscode.l10n.t('Virtual Whip: the Claude Code chat panel cannot receive messages. Enable the setting `claudeCode.useTerminal` to use Claude Code in a terminal.');
    }

    private async dispatch(message: string, options: SendOptions): Promise<void> {
        const terminal = this.pickTerminal(options.target);
        if (terminal) {
            await this.sendToTerminal(terminal, message, options);
            return;
        }
        if (options.target === 'claude') {
            this.output.appendLine('[router] target=claude but no terminal is available');
            this.hint(
                this.claudePanelInUse()
                    ? this.panelHint()
                    : vscode.l10n.t('Virtual Whip: no Claude Code terminal found. Start `claude` in a VS Code terminal.')
            );
            return;
        }
        if (options.target === 'auto') {
            this.explainFallbackToCopilot();
        }
        await this.sendToCopilot(message, options);
    }

    /**
     * "auto" found no Claude Code terminal and falls back to Copilot. That is the right thing to do
     * for a Copilot user, but a silent surprise for a Claude Code user whose setup cannot be
     * detected: say why, once.
     */
    private explainFallbackToCopilot(): void {
        if (this.claudePanelInUse() && !vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID)) {
            this.hintOnce('panel', this.panelHint());
            return;
        }
        const blind = vscode.window.terminals.filter((t) => t.shellIntegration === undefined);
        if (blind.length > 0) {
            this.output.appendLine(
                `[router] no Claude Code terminal detected; ${blind.length} terminal(s) have no shell integration, so Claude Code cannot be detected there`
            );
            this.hintOnce(
                'shell-integration',
                vscode.l10n.t('Virtual Whip: the message went to Copilot chat because no Claude Code terminal was detected. If Claude Code runs in a terminal without shell integration (such as cmd.exe), run "Virtual Whip: Use This Terminal for Claude Code" in it.')
            );
        }
    }

    private async sendToTerminal(terminal: vscode.Terminal, message: string, options: SendOptions): Promise<void> {
        this.lastClaudeTerminal = terminal;
        this.output.appendLine(`[router] -> terminal "${terminal.name}"${options.interrupt ? ' (interrupt)' : ''}`);

        if (options.interrupt) {
            const sinceLast = this.clock.now() - (this.lastEscape.get(terminal) ?? 0);
            if (sinceLast >= MIN_ESCAPE_GAP_MS) {
                // Escape interrupts the ongoing turn (no effect when Claude is idle); without it,
                // the message would be queued until the end of the turn.
                terminal.sendText(ESCAPE, false);
                this.lastEscape.set(terminal, this.clock.now());
                await this.clock.sleep(options.interruptDelayMs);
            }
        }

        if (options.preserveDraft) {
            await this.stashDraft(terminal);
        }

        if (options.reasoningEffort !== 'unchanged' && this.appliedEffort.get(terminal) !== options.reasoningEffort) {
            this.output.appendLine(`[router] /effort ${options.reasoningEffort}`);
            await this.typeLine(terminal, `/effort ${options.reasoningEffort}`);
            this.appliedEffort.set(terminal, options.reasoningEffort);
            await this.clock.sleep(EFFORT_SETTLE_MS);
        }

        await this.typeLine(terminal, message);

        if (options.preserveDraft) {
            await this.restoreDraft(terminal);
        }
    }

    /**
     * Puts what the user has typed in Claude Code's prompt aside, so that the message does not get
     * glued to it. The terminal API cannot read the prompt, so Claude Code's own editing keys are
     * used: go to the end of the line, type a marker, then "delete to the start of the line", which
     * moves the whole line (marker included) into the paste buffer. The marker guarantees that the
     * buffer is fresh even when the prompt was empty. A draft over several lines only has its last
     * line set aside.
     */
    private async stashDraft(terminal: vscode.Terminal): Promise<void> {
        for (const key of [CTRL_E, DRAFT_MARKER, CTRL_U]) {
            terminal.sendText(key, false);
            await this.clock.sleep(KEY_GAP_MS);
        }
    }

    /** Pastes the draft back once the message has left, then removes the marker. */
    private async restoreDraft(terminal: vscode.Terminal): Promise<void> {
        await this.clock.sleep(DRAFT_RESTORE_DELAY_MS);
        terminal.sendText(CTRL_Y, false);
        await this.clock.sleep(KEY_GAP_MS);
        terminal.sendText(BACKSPACE, false);
    }

    private async typeLine(terminal: vscode.Terminal, text: string): Promise<void> {
        terminal.sendText(text, false);
        await this.clock.sleep(SUBMIT_DELAY_MS);
        terminal.sendText('', true); // Enter alone
    }

    private async sendToCopilot(message: string, options: SendOptions): Promise<void> {
        this.output.appendLine(`[router] -> Copilot Chat${options.interrupt ? ' (stop and send)' : ''}`);
        if (options.reasoningEffort !== 'unchanged' && !this.warnedCopilotEffort) {
            this.warnedCopilotEffort = true;
            this.output.appendLine('[router] virtualWhip.reasoningEffort is not applied to Copilot Chat (no public API).');
        }
        // `workbench.action.chat.submit` is an internal VS Code command, not a public API: it can
        // change or disappear in a later version, so a failure is reported instead of swallowed.
        // `inputValue` replaces the content of the input box; `preserveInput` keeps the user's draft
        // there; `preserveFocus` asks for the focus to stay where it is (a VS Code version may
        // ignore it); `cancelCurrentRequest` = "stop and send" (otherwise the request would be
        // queued). `inputValue`, `cancelCurrentRequest` and `preserveInput` were checked against
        // the code of VS Code 1.138; `preserveFocus` was not.
        try {
            await vscode.commands.executeCommand(CHAT_SUBMIT_COMMAND, {
                inputValue: message,
                acceptInputOptions: {
                    cancelCurrentRequest: options.interrupt,
                    preserveFocus: true,
                    preserveInput: true
                }
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[router] Copilot Chat send failed (VS Code ${vscode.version}): ${detail}`);
            this.hint(vscode.l10n.t('Virtual Whip: sending to Copilot chat failed ({0}).', detail));
        }
    }

    private hint(text: string): void {
        const now = this.clock.now();
        if (now - this.lastHint < HINT_THROTTLE_MS) {
            return;
        }
        this.lastHint = now;
        void vscode.window.showInformationMessage(text);
    }

    private hintOnce(key: string, text: string): void {
        if (this.hintedOnce.has(key)) {
            return;
        }
        this.hintedOnce.add(key);
        void vscode.window.showInformationMessage(text);
    }
}
