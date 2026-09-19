import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Appearance } from './appearance';
import { LineSplitter, encodeConfigCommand, parseOverlayLine } from './protocol';

/** Delay between stopping the overlay and starting it again (lets the old process release its windows). */
export const RESTART_DELAY_MS = 300;

/** Key that must be held while flicking the mouse to crack the whip ("none" = no key needed). */
export type GestureModifier = 'none' | 'ctrl' | 'shift' | 'alt';

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
    gestureModifier: GestureModifier;
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
    private readonly stdoutLines = new LineSplitter();
    private commandChannelReady = false;
    private visible = false;
    private restartTimer: NodeJS.Timeout | undefined;

    constructor(extensionPath: string, private readonly output: vscode.OutputChannel) {
        this.overlayExe = path.join(extensionPath, 'overlay', 'bin', 'WhipOverlay.exe');
    }

    get running(): boolean {
        return this.proc !== undefined && !this.proc.killed;
    }

    /** True between the stop and the start of a restart. */
    get restarting(): boolean {
        return this.restartTimer !== undefined;
    }

    start(config: WhipConfig): boolean {
        if (this.running) {
            return true;
        }
        this.cancelRestart();
        this.stdoutLines.reset();

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
            for (const line of this.stdoutLines.push(d)) {
                const event = parseOverlayLine(line);
                switch (event.type) {
                    case 'ready':
                        this.commandChannelReady = true;
                        this.setVisible(this.visible);
                        break;
                    case 'anchor':
                        this.onAnchorMoved?.(event.x, event.y);
                        break;
                    case 'message':
                        this.onCrackMessage?.(event.text);
                        break;
                    case 'invalid':
                        this.output.appendLine(`[overlay] ${event.reason}`);
                        break;
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
        this.cancelRestart();
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
        this.proc = undefined;
    }

    /**
     * Stops the overlay and starts it again. The configuration is read when the overlay starts
     * again, not now: a burst of settings changes therefore ends with the last value, and a
     * restart already under way is not doubled.
     */
    restart(getConfig: () => WhipConfig): void {
        if (this.restarting) {
            return;
        }
        if (!this.running) {
            return;
        }
        this.stop();
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            this.start(getConfig());
            this.onStateChange?.(); // the exit of the old process had switched the status to "off"
        }, RESTART_DELAY_MS);
    }

    /** Hands a new configuration to the running overlay, for the settings that need no restart. */
    applyConfig(config: WhipConfig): boolean {
        if (!this.commandChannelReady || !this.running || !this.proc?.stdin) {
            return false;
        }
        this.proc.stdin.write(`${encodeConfigCommand(config)}\n`);
        return true;
    }

    private cancelRestart(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
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
