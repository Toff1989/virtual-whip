import * as vscode from 'vscode';
import { DEFAULT_PRESET, PRESETS, PRESET_NAMES, PresetName } from './appearance';
import { MessageRouter } from './messageRouter';
import { SECTION, readSendOptions, readWhipConfig, resetAppearanceSettings, showOnlyWhenFocused } from './settings';
import { SidecarManager } from './sidecarManager';

const ANCHOR_STATE_KEY = 'virtualWhip.anchorCustom';

/** Settings that require restarting the overlay (the others are read again on every crack). */
const OVERLAY_SETTINGS = [
    'audioFilePath', 'sound', 'cooldownMs', 'sensitivity', 'maxLength', 'anchorPosition',
    'messages', 'appearance', 'whip', 'anchor', 'effect'
];

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

    const restartOverlay = (): void => {
        if (sidecar.running) {
            sidecar.restart(currentConfig());
            setTimeout(syncOverlayVisibility, 350);
        }
    };

    context.subscriptions.push(
        statusBarItem,
        output,
        router,
        { dispose: () => sidecar.stop() },
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
            restartOverlay();
            vscode.window.showInformationMessage(vscode.l10n.t('Virtual Whip: the anchor point is back to its default position.'));
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
            // Choosing a corner in the settings replaces the position dragged with the mouse.
            if (e.affectsConfiguration(`${SECTION}.anchorPosition`)) {
                await context.globalState.update(ANCHOR_STATE_KEY, undefined);
            }
            if (OVERLAY_SETTINGS.some((key) => e.affectsConfiguration(`${SECTION}.${key}`))) {
                restartOverlay();
            } else if (e.affectsConfiguration(`${SECTION}.showOnlyWhenFocused`)) {
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
