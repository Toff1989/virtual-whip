// Tests of the appearance module (npm test). They run on the compiled code, without VS Code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PRESET, PRESETS, PRESET_NAMES, resolveAppearance } = require('../out/appearance');
const pkg = require('../package.json');

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const properties = Object.assign({}, ...pkg.contributes.configuration.map((section) => section.properties));
const leather = PRESETS[DEFAULT_PRESET].appearance;

test('package.json defaults match the default style', () => {
    for (const [section, values] of Object.entries(leather)) {
        for (const [key, expected] of Object.entries(values)) {
            const property = properties[`virtualWhip.${section}.${key}`];
            assert.ok(property, `virtualWhip.${section}.${key} is missing from package.json`);
            assert.deepEqual(property.default, expected, `default of virtualWhip.${section}.${key}`);
        }
    }
});

test('package.json declares no appearance setting unknown to the code', () => {
    for (const name of Object.keys(properties)) {
        const match = /^virtualWhip\.(whip|anchor|effect)\.(.+)$/.exec(name);
        if (match) {
            assert.ok(match[2] in leather[match[1]], `${name} does not exist in Appearance`);
        }
    }
});

test('the list of styles in package.json is the one in the code', () => {
    const preset = properties['virtualWhip.appearance.preset'];
    assert.deepEqual(preset.enum, PRESET_NAMES);
    assert.equal(preset.default, DEFAULT_PRESET);
    assert.equal(preset.enumDescriptions.length, PRESET_NAMES.length);
});

test('the limits in package.json are the ones actually enforced', () => {
    for (const [section, values] of Object.entries(leather)) {
        for (const [key, value] of Object.entries(values)) {
            const property = properties[`virtualWhip.${section}.${key}`];
            if (typeof value !== 'number') continue;
            const resolve = (v) => resolveAppearance(DEFAULT_PRESET, { [section]: { [key]: v } })[section][key];
            assert.equal(resolve(property.maximum + 1000), property.maximum, `maximum of virtualWhip.${section}.${key}`);
            assert.equal(resolve(property.minimum - 1000), property.minimum, `minimum of virtualWhip.${section}.${key}`);
        }
    }
});

test('every style has valid colors and is stable', () => {
    for (const name of PRESET_NAMES) {
        const { whip, anchor, effect } = PRESETS[name].appearance;
        for (const value of [whip.colorBase, whip.colorTip, anchor.color, effect.color]) {
            assert.match(value, HEX, `invalid color in style ${name}`);
        }
        assert.deepEqual(resolveAppearance(name), PRESETS[name].appearance, `style ${name} must be stable`);
    }
});

test('an unknown style falls back to the default style', () => {
    assert.deepEqual(resolveAppearance('whatever'), leather);
});

test('the user\'s settings win, the rest follows the style', () => {
    const result = resolveAppearance('neon', { whip: { thickness: 12, colorBase: '#ff0000' } });
    assert.equal(result.whip.thickness, 12);
    assert.equal(result.whip.colorBase, '#ff0000');
    assert.equal(result.whip.colorTip, PRESETS.neon.appearance.whip.colorTip);
    assert.equal(result.whip.glow, PRESETS.neon.appearance.whip.glow);
    assert.equal(result.anchor.color, PRESETS.neon.appearance.anchor.color);
});

test('an explicit 0 or false is not ignored', () => {
    const result = resolveAppearance('fire', { whip: { glow: 0 }, effect: { enabled: false, rays: 0 } });
    assert.equal(result.whip.glow, 0);
    assert.equal(result.effect.enabled, false);
    assert.equal(result.effect.rays, 0);
});

test('invalid values fall back to a safe value', () => {
    const result = resolveAppearance('ice', {
        whip: { colorBase: 'red', colorTip: '#12345', opacity: Number.NaN, thickness: 'thick' },
        effect: { rays: 3.6, color: 42 }
    });
    assert.equal(result.whip.colorBase, PRESETS.ice.appearance.whip.colorBase);
    assert.equal(result.whip.colorTip, PRESETS.ice.appearance.whip.colorTip);
    assert.equal(result.whip.opacity, PRESETS.ice.appearance.whip.opacity);
    assert.equal(result.whip.thickness, PRESETS.ice.appearance.whip.thickness);
    assert.equal(result.effect.rays, 4);
    assert.equal(result.effect.color, PRESETS.ice.appearance.effect.color);
});

test('short colors (#RGB) are accepted', () => {
    assert.equal(resolveAppearance(DEFAULT_PRESET, { anchor: { color: '#a5c' } }).anchor.color, '#a5c');
});

test('security: settings whose text is typed into a terminal are user-only', () => {
    for (const name of ['virtualWhip.messages', 'virtualWhip.target', 'virtualWhip.reasoningEffort']) {
        assert.equal(properties[name].scope, 'application', `${name} must have the "application" scope`);
    }
});
