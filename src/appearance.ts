// Whip appearance: built-in styles and "style + custom settings" resolution.
// This module does not depend on VS Code: it is tested directly with `npm test`.

export interface WhipAppearance {
    /** Color of the base of the rope (#RGB or #RRGGBB). */
    colorBase: string;
    /** Color of the tip of the rope. */
    colorTip: string;
    /** Opacity of the rope and of the effect, from 0.1 to 1. */
    opacity: number;
    /** Thickness at the base, in pixels. */
    thickness: number;
    /** Thickness at the tip, in pixels. */
    tipThickness: number;
    /** Intensity of the glow, from 0 (none) to 1. */
    glow: number;
    /** Weight of the rope: 0 = it floats, 1.5 = very heavy. */
    gravity: number;
    /** Inertia: the closer to 1, the longer the rope keeps swinging. */
    damping: number;
}

export interface AnchorAppearance {
    color: string;
    /** Radius of the anchor point, in pixels. */
    size: number;
}

export interface EffectAppearance {
    enabled: boolean;
    color: string;
    /** Scale of the effect, from 0.3 to 3. */
    size: number;
    durationMs: number;
    /** Number of rays around the shock wave (0 = wave only). */
    rays: number;
}

export interface Appearance {
    whip: WhipAppearance;
    anchor: AnchorAppearance;
    effect: EffectAppearance;
}

export type PresetName = 'leather' | 'neon' | 'fire' | 'ice' | 'gold' | 'shadow';

export interface Preset {
    /** English label; translated at display time with vscode.l10n. */
    label: string;
    /** English description; translated at display time with vscode.l10n. */
    description: string;
    appearance: Appearance;
}

function preset(
    label: string,
    description: string,
    whip: Partial<WhipAppearance> & Pick<WhipAppearance, 'colorBase' | 'colorTip'>,
    anchorColor: string,
    effectColor: string
): Preset {
    return {
        label,
        description,
        appearance: {
            whip: { opacity: 0.9, thickness: 7, tipThickness: 2, glow: 0, gravity: 0.35, damping: 0.985, ...whip },
            anchor: { color: anchorColor, size: 9 },
            effect: { enabled: true, color: effectColor, size: 1, durationMs: 380, rays: 8 }
        }
    };
}

/** The "leather" style is also the default of every setting in package.json. */
export const PRESETS: Record<PresetName, Preset> = {
    leather: preset('Leather', 'Brown leather whip, understated (default).', { colorBase: '#785032', colorTip: '#D2A064' }, '#3C2D1E', '#FFE6B4'),
    neon: preset('Neon', 'Cyan to magenta stroke with a bright glow.', { colorBase: '#00E5FF', colorTip: '#FF2BD6', opacity: 1, thickness: 5, glow: 0.8 }, '#14213D', '#7DF9FF'),
    fire: preset('Fire', 'Dark red to yellow, warm glow.', { colorBase: '#B71C1C', colorTip: '#FFD54F', opacity: 0.95, glow: 0.5 }, '#4E1A0F', '#FFB300'),
    ice: preset('Ice', 'Glacier blue to white, cold glow.', { colorBase: '#4FC3F7', colorTip: '#E1F5FE', thickness: 6, glow: 0.4 }, '#1B3A57', '#E1F5FE'),
    gold: preset('Gold', 'Burnished gold to pale yellow, soft glow.', { colorBase: '#B8860B', colorTip: '#FFE082', opacity: 1, thickness: 6, glow: 0.3 }, '#5D4037', '#FFF59D'),
    shadow: preset('Shadow', 'Discreet slate gray, no glow.', { colorBase: '#263238', colorTip: '#90A4AE', opacity: 0.85 }, '#111111', '#CFD8DC')
};

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];
export const DEFAULT_PRESET: PresetName = 'leather';

/** Settings typed by the user: only the ones actually modified are present. */
export interface AppearanceOverrides {
    whip?: Partial<WhipAppearance>;
    anchor?: Partial<AnchorAppearance>;
    effect?: Partial<EffectAppearance>;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function color(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Applies the user's custom settings on top of the chosen style. Any invalid value
 * (misspelled color, out-of-range number...) falls back to a safe value.
 */
export function resolveAppearance(presetName: string, overrides: AppearanceOverrides = {}): Appearance {
    const base = (PRESETS as Record<string, Preset | undefined>)[presetName] ?? PRESETS[DEFAULT_PRESET];
    const { whip, anchor, effect } = base.appearance;
    const w = overrides.whip ?? {};
    const a = overrides.anchor ?? {};
    const e = overrides.effect ?? {};

    return {
        whip: {
            colorBase: color(w.colorBase, whip.colorBase),
            colorTip: color(w.colorTip, whip.colorTip),
            opacity: number(w.opacity ?? whip.opacity, whip.opacity, 0.1, 1),
            thickness: number(w.thickness ?? whip.thickness, whip.thickness, 1, 30),
            tipThickness: number(w.tipThickness ?? whip.tipThickness, whip.tipThickness, 1, 20),
            glow: number(w.glow ?? whip.glow, whip.glow, 0, 1),
            gravity: number(w.gravity ?? whip.gravity, whip.gravity, 0, 1.5),
            damping: number(w.damping ?? whip.damping, whip.damping, 0.9, 0.999)
        },
        anchor: {
            color: color(a.color, anchor.color),
            size: number(a.size ?? anchor.size, anchor.size, 4, 20)
        },
        effect: {
            enabled: typeof e.enabled === 'boolean' ? e.enabled : effect.enabled,
            color: color(e.color, effect.color),
            size: number(e.size ?? effect.size, effect.size, 0.3, 3),
            durationMs: number(e.durationMs ?? effect.durationMs, effect.durationMs, 100, 2000),
            rays: Math.round(number(e.rays ?? effect.rays, effect.rays, 0, 24))
        }
    };
}
