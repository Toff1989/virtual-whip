import * as vscode from 'vscode';
import { DEFAULT_PRESET, PRESETS, PRESET_NAMES, PresetName } from './appearance';
import { MessageRouter } from './messageRouter';
import {
    ConfigChange, SECTION, classifyConfigChange, readSendOptions, readWhipConfig, resetAppearanceSettings, showOnlyWhenFocused
} from './settings';
import { SidecarManager } from './sidecarManager';

const ANCHOR_STATE_KEY = 'virtualWhip.anchorCustom';

/** Settings changes that follow each other closer than this are handled as one. */
export const CONFIG_DEBOUNCE_MS = 250;

let sidecar: SidecarManager;
let router: MessageRouter;
let statusBarItem: vscode.StatusBarItem;

function updateStatusBar(): void {
    if (sidecar.running) {
        statusBarItem.text = vscode.l10n.t('$(flame) Whip on');
        statusBarItem.tooltip = vscode.l10n.t('The whip is shown. Click to hide it.');
    } else {
        statusBarItem.text = vscode.l10n.t('$(circle-slash) Whip off');
        statusBarItem.tooltip = vscode.l10n.t('Click to show the virtual whip.');
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Virtual Whip');
    sidecar = new SidecarManager(context.extensionPath, output);
    router = new MessageRouter(output);
    sidecar.onStateChange = updateStatusBar;

    const currentConfig = () =>
        readWhipConfig(context.extensionPath, context.globalState.get<{ x: number; y: number }>(ANCHOR_STATE_KEY));

    // By default the whip is only visible while the VS Code window has the focus.
    const syncOverlayVisibility = (): void => {
        sidecar.setVisible(vscode.window.state.focused || !showOnlyWhenFocused());
    };

    // The message is never displayed on screen: it goes straight to Claude Code / Copilot.
    sidecar.onCrackMessage = (message) => router.send(message, readSendOptions());

    // The anchor point was dragged with the mouse: remember its new position.
    sidecar.onAnchorMoved = (x, y) => {
        void context.globalState.update(ANCHOR_STATE_KEY, { x, y });
    };

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'virtualWhip.toggleOverlay';
    updateStatusBar();
    statusBarItem.show();

    // Settings changes are gathered, then applied once, with the values they have at that moment
    // (resetting the appearance changes about twenty settings, one after the other).
    let pendingChange: ConfigChange = 'none';
    let changeTimer: NodeJS.Timeout | undefined;
    const applyPendingChange = (): void => {
        changeTimer = undefined;
        const change = pendingChange;
        pendingChange = 'none';
        if (change === 'restart') {
            sidecar.restart(currentConfig);
        } else if (change === 'live' && !sidecar.applyConfig(currentConfig())) {
            // Not ready to receive it (starting up, or not running): a running overlay picks the
            // new values up at its next start.
            sidecar.restart(currentConfig);
        }
    };
    const scheduleChange = (change: ConfigChange): void => {
        if (change === 'none') {
            return;
        }
        pendingChange = pendingChange === 'restart' || change === 'restart' ? 'restart' : 'live';
        if (changeTimer) {
            clearTimeout(changeTimer);
        }
        changeTimer = setTimeout(applyPendingChange, CONFIG_DEBOUNCE_MS);
    };

    context.subscriptions.push(
        statusBarItem,
        output,
        router,
        {
            dispose: () => {
                if (changeTimer) {
                    clearTimeout(changeTimer);
                }
                sidecar.stop();
            }
        },
        vscode.commands.registerCommand('virtualWhip.toggleOverlay', () => {
            if (sidecar.running) {
                sidecar.stop();
            } else if (sidecar.start(currentConfig())) {
                syncOverlayVisibility();
            }
            updateStatusBar();
        }),
        vscode.commands.registerCommand('virtualWhip.crackNow', () => {
            if (!sidecar.triggerCrackNow()) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Virtual Whip: show the whip first (command "Virtual Whip: Toggle Whip").')
                );
            }
        }),
        vscode.commands.registerCommand('virtualWhip.resetAnchor', async () => {
            await context.globalState.update(ANCHOR_STATE_KEY, undefined);
            scheduleChange('restart');
            vscode.window.showInformationMessage(vscode.l10n.t('Virtual Whip: the anchor point is back to its default position.'));
        }),
        vscode.commands.registerCommand('virtualWhip.markClaudeTerminal', () => {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                vscode.window.showInformationMessage(vscode.l10n.t('Virtual Whip: there is no active terminal.'));
                return;
            }
            vscode.window.showInformationMessage(
                router.toggleMarkedTerminal(terminal)
                    ? vscode.l10n.t('Virtual Whip: this terminal is now treated as a Claude Code terminal.')
                    : vscode.l10n.t('Virtual Whip: this terminal is no longer marked as a Claude Code terminal.')
            );
        }),
        vscode.commands.registerCommand('virtualWhip.diagnose', async () => {
            const report = await router.diagnose(readSendOptions().target);
            const overlay = sidecar.running ? 'running' : 'stopped';
            const version = String(context.extension?.packageJSON?.version ?? 'unknown');
            output.appendLine(['[diagnose] Virtual Whip ' + version, `Overlay: ${overlay}`, ...report].join('\n[diagnose] '));
            // The log is only brought forward when the user asks for it: nothing else may change what is on screen.
            const showLog = vscode.l10n.t('Show Log');
            const answer = await vscode.window.showInformationMessage(
                vscode.l10n.t('Virtual Whip: the diagnostics were written to the "Virtual Whip" output.'),
                showLog
            );
            if (answer === showLog) {
                output.show(true);
            }
        }),
        vscode.commands.registerCommand('virtualWhip.choosePreset', async () => {
            const cfg = vscode.workspace.getConfiguration(SECTION);
            const current = cfg.get<string>('appearance.preset', DEFAULT_PRESET);
            const picked = await vscode.window.showQuickPick(
                PRESET_NAMES.map((name: PresetName) => ({
                    label: vscode.l10n.t(PRESETS[name].label),
                    description: name === current ? vscode.l10n.t('(current)') : undefined,
                    detail: vscode.l10n.t(PRESETS[name].description),
                    name
                })),
                {
                    title: vscode.l10n.t('Virtual Whip: choose a style'),
                    placeHolder: vscode.l10n.t('Appearance settings you changed still take precedence.')
                }
            );
            if (picked) {
                await cfg.update('appearance.preset', picked.name, vscode.ConfigurationTarget.Global);
            }
        }),
        vscode.commands.registerCommand('virtualWhip.resetAppearance', async () => {
            const reset = vscode.l10n.t('Reset');
            const confirm = await vscode.window.showWarningMessage(
                vscode.l10n.t('Reset the style and all appearance settings of the whip to their defaults?'),
                { modal: true },
                reset
            );
            if (confirm === reset) {
                await resetAppearanceSettings();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (!e.affectsConfiguration(SECTION)) {
                return;
            }
            const affects = (key: string) => e.affectsConfiguration(`${SECTION}.${key}`);
            // Choosing a corner in the settings replaces the position dragged with the mouse.
            if (affects('anchorPosition')) {
                await context.globalState.update(ANCHOR_STATE_KEY, undefined);
            }
            const change = classifyConfigChange(affects);
            if (change !== 'none') {
                scheduleChange(change);
            } else if (affects('showOnlyWhenFocused')) {
                syncOverlayVisibility();
            }
        }),
        vscode.window.onDidChangeWindowState(() => syncOverlayVisibility())
    );

    if (vscode.workspace.getConfiguration(SECTION).get<boolean>('autoStart', false)) {
        if (sidecar.start(currentConfig())) {
            syncOverlayVisibility();
        }
        updateStatusBar();
    }
}

export function deactivate(): void {
    console.log('[Virtual Whip] extension deactivated; stopping overlay');
    sidecar?.stop();
}
