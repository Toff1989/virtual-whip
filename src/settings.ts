import * as path from 'path';
import * as vscode from 'vscode';
import { Appearance, AppearanceOverrides, DEFAULT_PRESET, resolveAppearance } from './appearance';
import { resolveMessages } from './messages';
import { ReasoningEffort, SendOptions, WhipTarget } from './messageRouter';
import { GestureModifier, WhipConfig } from './sidecarManager';

/** Name of the settings section: every setting is `virtualWhip.<key>`. */
export const SECTION = 'virtualWhip';

// What a change of setting requires from the running overlay. Every setting declared in
// package.json is in exactly one of these three lists (a test enforces it): a new setting cannot
// be forgotten.

/** Applied to the running overlay without restarting it. */
export const LIVE_SETTINGS = [
    'appearance', 'whip', 'anchor', 'effect', 'sensitivity', 'cooldownMs', 'messages', 'gestureModifier'
] as const;
/** The overlay must be restarted (rope length, corner, sound file). */
export const RESTART_SETTINGS = ['audioFilePath', 'sound', 'maxLength', 'anchorPosition'] as const;
/** Read by the extension itself when needed: the overlay does not care. */
export const EXTENSION_SETTINGS = [
    'autoStart', 'showOnlyWhenFocused', 'target', 'interruptBeforeSend', 'interruptDelayMs', 'reasoningEffort',
    'preserveTerminalDraft'
] as const;

export type ConfigChange = 'restart' | 'live' | 'none';

/** `affects(key)` tells whether the setting `virtualWhip.<key>` (or something under it) changed. */
export function classifyConfigChange(affects: (key: string) => boolean): ConfigChange {
    if (RESTART_SETTINGS.some(affects)) {
        return 'restart';
    }
    return LIVE_SETTINGS.some(affects) ? 'live' : 'none';
}

/** Individual appearance settings (the style itself is `appearance.preset`). */
export const APPEARANCE_KEYS = {
    whip: ['colorBase', 'colorTip', 'opacity', 'thickness', 'tipThickness', 'glow', 'gravity', 'damping'],
    anchor: ['color', 'size'],
    effect: ['enabled', 'color', 'size', 'durationMs', 'rays']
} as const;

/**
 * Value explicitly typed by the user. The default value from package.json is not one: this is
 * what lets the chosen style apply as long as a setting has not been touched.
 */
function explicitValue<T>(cfg: vscode.WorkspaceConfiguration, key: string): T | undefined {
    const info = cfg.inspect<T>(key);
    return info?.workspaceFolderValue ?? info?.workspaceValue ?? info?.globalValue;
}

function explicitSection(cfg: vscode.WorkspaceConfiguration, section: string, keys: readonly string[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const key of keys) {
        const value = explicitValue<unknown>(cfg, `${section}.${key}`);
        if (value !== undefined) {
            values[key] = value;
        }
    }
    return values;
}

export function readAppearance(cfg = vscode.workspace.getConfiguration(SECTION)): Appearance {
    const overrides: AppearanceOverrides = {
        whip: explicitSection(cfg, 'whip', APPEARANCE_KEYS.whip),
        anchor: explicitSection(cfg, 'anchor', APPEARANCE_KEYS.anchor),
        effect: explicitSection(cfg, 'effect', APPEARANCE_KEYS.effect)
    };
    return resolveAppearance(cfg.get<string>('appearance.preset', DEFAULT_PRESET), overrides);
}

/** Sound path: the built-in sound when the setting is empty; `${workspaceFolder}` is accepted. */
export function resolveAudioPath(configured: string, extensionPath: string): string {
    const trimmed = configured.trim();
    if (!trimmed) {
        return path.join(extensionPath, 'assets', 'crack.wav');
    }
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return trimmed.replace(/\$\{workspaceFolder\}/g, workspace);
}

const GESTURE_MODIFIERS: readonly GestureModifier[] = ['none', 'ctrl', 'shift', 'alt'];

function readGestureModifier(cfg: vscode.WorkspaceConfiguration): GestureModifier {
    const value = cfg.get<string>('gestureModifier', 'none');
    return GESTURE_MODIFIERS.find((m) => m === value) ?? 'none';
}

export function readWhipConfig(
    extensionPath: string,
    anchorCustom: { x: number; y: number } | undefined
): WhipConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    return {
        audioFilePath: resolveAudioPath(cfg.get<string>('audioFilePath', ''), extensionPath),
        volume: cfg.get<number>('sound.volume', 100),
        cooldownMs: cfg.get<number>('cooldownMs', 650),
        appearance: readAppearance(cfg),
        // The user's own list, or the built-in messages in the display language of VS Code.
        messages: resolveMessages(explicitValue<string[]>(cfg, 'messages'), (text) => vscode.l10n.t(text)),
        sensitivity: cfg.get<number>('sensitivity', 3.5),
        gestureModifier: readGestureModifier(cfg),
        maxLength: cfg.get<number>('maxLength', 450),
        anchorPosition: cfg.get<string>('anchorPosition', 'bottom-right'),
        anchorCustom
    };
}

export function readSendOptions(): SendOptions {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    return {
        target: cfg.get<WhipTarget>('target', 'auto'),
        interrupt: cfg.get<boolean>('interruptBeforeSend', true),
        interruptDelayMs: cfg.get<number>('interruptDelayMs', 200),
        reasoningEffort: cfg.get<ReasoningEffort>('reasoningEffort', 'unchanged'),
        preserveDraft: cfg.get<boolean>('preserveTerminalDraft', false)
    };
}

export function showOnlyWhenFocused(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('showOnlyWhenFocused', true);
}

/** Resets the style and every appearance setting to its default value. */
export async function resetAppearanceSettings(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    const keys = [
        'appearance.preset',
        ...APPEARANCE_KEYS.whip.map((k) => `whip.${k}`),
        ...APPEARANCE_KEYS.anchor.map((k) => `anchor.${k}`),
        ...APPEARANCE_KEYS.effect.map((k) => `effect.${k}`)
    ];
    for (const key of keys) {
        const info = cfg.inspect(key);
        if (info?.globalValue !== undefined) {
            await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
        if (info?.workspaceValue !== undefined) {
            await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
    }
}
