import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Appearance } from './appearance';

/** Configuration handed to the overlay (JSON in the WHIP_CONFIG environment variable). */
export interface WhipConfig {
    /** Path of the crack sound (the built-in sound when the setting is empty). */
    audioFilePath: string;
    /** Sound volume, from 0 (muted) to 100. */
    volume: number;
    /** Minimum delay between two cracks, in milliseconds. */
    cooldownMs: number;
    /** Appearance, already resolved (style + custom settings). */
    appearance: Appearance;
    messages: string[];
    sensitivity: number;
    /** Maximum length of the whip, in pixels. */
    maxLength: number;
    anchorPosition: string;
    /** Custom anchor position (fractions 0..1 of the screen), if the user moved it. */
    anchorCustom?: { x: number; y: number };
}

export class SidecarManager {
    private proc: cp.ChildProcess | undefined;
    private readonly overlayExe: string;

    /** Called whenever the running state may have changed (e.g. the process crashed). */
    onStateChange: (() => void) | undefined;
    /** Called when the overlay requests that its current message be sent. */
    onCrackMessage: ((message: string) => void) | undefined;
    /** Called when the user dropped the anchor point somewhere else (fractions 0..1 of the screen). */
    onAnchorMoved: ((x: number, y: number) => void) | undefined;
    private stdoutBuffer = '';
    private commandChannelReady = false;
    private visible = false;

    constructor(extensionPath: string, private readonly output: vscode.OutputChannel) {
        this.overlayExe = path.join(extensionPath, 'overlay', 'bin', 'WhipOverlay.exe');
    }

    get running(): boolean {
        return this.proc !== undefined && !this.proc.killed;
    }

    start(config: WhipConfig): boolean {
        if (this.running) {
            return true;
        }

        // No output.show(): the visible panel (Claude Code terminal, chat...) must never change.
        this.output.appendLine(`[overlay] starting ${this.overlayExe}`);
        this.commandChannelReady = false;

        if (process.platform !== 'win32') {
            this.output.appendLine('[overlay] unsupported platform: the overlay only runs on Windows.');
            vscode.window.showErrorMessage(vscode.l10n.t('Virtual Whip: the overlay only works on Windows.'));
            return false;
        }
        if (!fs.existsSync(this.overlayExe)) {
            this.output.appendLine('[overlay] executable not found. Run "npm run compile" in the project folder.');
            vscode.window.showErrorMessage(
                vscode.l10n.t('Virtual Whip: the overlay is not compiled. Run "npm run compile" in the project folder.')
            );
            return false;
        }

        const child = cp.spawn(this.overlayExe, [], {
            env: { ...process.env, WHIP_CONFIG: JSON.stringify(config) },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });
        this.proc = child;

        this.output.appendLine(`[overlay] spawned overlay (pid ${child.pid ?? 'unknown'})`);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (d: string) => {
            this.output.append(d);
            this.stdoutBuffer += d;
            const lines = this.stdoutBuffer.split(/\r?\n/);
            this.stdoutBuffer = lines.pop() ?? '';
            for (const line of lines) {
                if (line === 'OVERLAY_READY') {
                    this.commandChannelReady = true;
                    this.setVisible(this.visible);
                    continue;
                }
                const anchorPrefix = 'WHIP_ANCHOR:';
                if (line.startsWith(anchorPrefix)) {
                    const [x, y] = line.slice(anchorPrefix.length).split(',').map(Number);
                    if (Number.isFinite(x) && Number.isFinite(y)) {
                        this.onAnchorMoved?.(x, y);
                    }
                    continue;
                }
                const messagePrefix = 'WHIP_MESSAGE:';
                if (line.startsWith(messagePrefix)) {
                    const encoded = line.slice(messagePrefix.length);
                    try {
                        this.onCrackMessage?.(Buffer.from(encoded, 'base64').toString('utf8'));
                    } catch (err) {
                        this.output.appendLine(`[overlay] invalid message protocol: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }
        });
        child.stdin?.on('error', (err) => this.output.appendLine(`[overlay] stdin error: ${err.message}`));
        child.stderr?.on('data', (d: string) => this.output.append(`[overlay:err] ${d}`));
        child.on('exit', (code, signal) => {
            this.output.appendLine(`[overlay] process exited with code ${code}, signal ${signal ?? 'none'}`);
            // A restart may already have replaced the process: only reset the state of this one.
            if (this.proc === child) {
                this.proc = undefined;
                this.commandChannelReady = false;
            }
            this.onStateChange?.();
        });
        child.on('error', (err) => {
            this.output.appendLine(`[overlay] failed to start: ${err.message}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Virtual Whip: unable to start the overlay ({0})', err.message));
            if (this.proc === child) {
                this.proc = undefined;
                this.commandChannelReady = false;
            }
            this.onStateChange?.();
        });

        return true;
    }

    stop(): void {
        this.output.appendLine('[overlay] stop requested');
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
        this.proc = undefined;
    }

    restart(config: WhipConfig): void {
        if (this.running) {
            this.stop();
            setTimeout(() => this.start(config), 300);
        }
    }

    triggerCrackNow(): boolean {
        if (!this.running || !this.proc?.stdin) {
            return false;
        }
        this.proc.stdin.write('CRACK\n');
        return true;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (!this.commandChannelReady || !this.running || !this.proc?.stdin) {
            return;
        }
        this.proc.stdin.write(`${visible ? 'SHOW' : 'HIDE'}\n`);
    }
}
