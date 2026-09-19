// Tests of src/settings.ts with a fake "vscode" module: the settings-reading logic (settings
// actually modified, scopes, sound path) is checked without launching VS Code.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const pkg = require('../package.json');

const defaults = {};
for (const section of pkg.contributes.configuration) {
    for (const [name, property] of Object.entries(section.properties)) {
        defaults[name] = property.default;
    }
}

const state = { global: {}, workspace: {}, folders: [], updates: [] };

const vscodeMock = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
        get workspaceFolders() { return state.folders; },
        getConfiguration(section) {
            const full = (key) => `${section}.${key}`;
            return {
                get(key, fallback) {
                    const name = full(key);
                    if (name in state.workspace) return state.workspace[name];
                    if (name in state.global) return state.global[name];
                    return name in defaults ? defaults[name] : fallback;
                },
                inspect(key) {
                    const name = full(key);
                    return { defaultValue: defaults[name], globalValue: state.global[name], workspaceValue: state.workspace[name] };
                },
                async update(key, value, target) {
                    state.updates.push({ key: full(key), value, target });
                }
            };
        }
    }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscodeMock : originalLoad.call(this, request, ...rest);
};
const settings = require('../out/settings');
const { PRESETS } = require('../out/appearance');
Module._load = originalLoad;

const key = (name) => `${settings.SECTION}.${name}`;

function reset() {
    state.global = {};
    state.workspace = {};
    state.folders = [];
    state.updates = [];
}

test('with no setting at all, the appearance is the leather style', () => {
    reset();
    assert.deepEqual(settings.readAppearance(), PRESETS.leather.appearance);
});

test('choosing a style alone applies the whole style', () => {
    reset();
    state.global[key('appearance.preset')] = 'neon';
    assert.deepEqual(settings.readAppearance(), PRESETS.neon.appearance);
});

test('a modified setting wins over the style, the others follow the style', () => {
    reset();
    state.global[key('appearance.preset')] = 'fire';
    state.global[key('whip.thickness')] = 12;
    const { whip, effect } = settings.readAppearance();
    assert.equal(whip.thickness, 12);
    assert.equal(whip.colorBase, PRESETS.fire.appearance.whip.colorBase);
    assert.equal(effect.color, PRESETS.fire.appearance.effect.color);
});

test('workspace settings win over user settings', () => {
    reset();
    state.global[key('whip.opacity')] = 0.5;
    state.workspace[key('whip.opacity')] = 0.7;
    assert.equal(settings.readAppearance().whip.opacity, 0.7);
});

test('an explicit value equal to the package.json default is still a user choice', () => {
    reset();
    state.global[key('appearance.preset')] = 'neon';
    state.global[key('whip.colorBase')] = defaults[key('whip.colorBase')];
    assert.equal(settings.readAppearance().whip.colorBase, defaults[key('whip.colorBase')]);
    assert.notEqual(settings.readAppearance().whip.colorBase, PRESETS.neon.appearance.whip.colorBase);
});

test('an invalid value typed by the user is neutralized', () => {
    reset();
    state.global[key('whip.colorTip')] = 'not a color';
    state.global[key('whip.thickness')] = 9999;
    const { whip } = settings.readAppearance();
    assert.equal(whip.colorTip, PRESETS.leather.appearance.whip.colorTip);
    assert.equal(whip.thickness, 30);
});

test('the built-in sound is used when no file is configured', () => {
    reset();
    const config = settings.readWhipConfig('C:\\ext', undefined);
    assert.equal(config.audioFilePath, path.join('C:\\ext', 'assets', 'crack.wav'));
    assert.equal(config.volume, 100);
    assert.equal(config.cooldownMs, 650);
    assert.equal(config.maxLength, 450);
    assert.deepEqual(config.appearance, PRESETS.leather.appearance);
});

test('the default messages are the English ones from package.json', () => {
    reset();
    const { messages } = settings.readWhipConfig('C:\\ext', undefined);
    assert.equal(messages.length, 6);
    assert.equal(messages[0], 'Come on, faster!');
});

test('${workspaceFolder} is replaced in the sound path', () => {
    reset();
    state.folders = [{ uri: { fsPath: 'D:\\project' } }];
    assert.equal(settings.resolveAudioPath('${workspaceFolder}\\sounds\\clack.wav', 'C:\\ext'), 'D:\\project\\sounds\\clack.wav');
    assert.equal(settings.resolveAudioPath('E:\\other.mp3', 'C:\\ext'), 'E:\\other.mp3');
});

test('the custom anchor point position is passed on', () => {
    reset();
    const config = settings.readWhipConfig('C:\\ext', { x: 0.25, y: 0.5 });
    assert.deepEqual(config.anchorCustom, { x: 0.25, y: 0.5 });
});

test('default send options and visibility', () => {
    reset();
    assert.deepEqual(settings.readSendOptions(), {
        target: 'auto', interrupt: true, interruptDelayMs: 200, reasoningEffort: 'unchanged'
    });
    assert.equal(settings.showOnlyWhenFocused(), true);
    state.global[key('showOnlyWhenFocused')] = false;
    assert.equal(settings.showOnlyWhenFocused(), false);
});

test('resetting the appearance only clears appearance settings, in the right scope', async () => {
    reset();
    state.global[key('appearance.preset')] = 'neon';
    state.global[key('whip.thickness')] = 12;
    state.workspace[key('effect.color')] = '#ff0000';
    state.global[key('maxLength')] = 800; // must not be touched
    await settings.resetAppearanceSettings();
    const cleared = Object.fromEntries(state.updates.map((u) => [u.key, u]));
    assert.equal(cleared[key('appearance.preset')].target, vscodeMock.ConfigurationTarget.Global);
    assert.equal(cleared[key('whip.thickness')].target, vscodeMock.ConfigurationTarget.Global);
    assert.equal(cleared[key('effect.color')].target, vscodeMock.ConfigurationTarget.Workspace);
    assert.ok(state.updates.every((u) => u.value === undefined), 'every update must remove the setting');
    assert.ok(!(key('maxLength') in cleared), 'maxLength must not be reset');
    assert.equal(state.updates.length, 3, 'only the settings that are actually set are touched');
});
