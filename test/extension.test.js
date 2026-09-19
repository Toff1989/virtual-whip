// Tests of src/extension.ts with a fake "vscode" module: what the extension registers and reads
// must match what package.json declares (commands, settings, command titles quoted in messages).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const pkg = require('../package.json');
const en = require('../package.nls.json');

const properties = Object.assign({}, ...pkg.contributes.configuration.map((section) => section.properties));
const registered = new Map();
const shown = { info: [], warning: [] };
const accessed = new Set();
const updates = [];
const nothing = () => ({ dispose() {} });
const statusBar = { text: '', tooltip: '', command: '', show() {}, dispose() {} };
let quickPickItems;
let quickPickAnswer;
let warningAnswer;

const vscodeMock = {
    StatusBarAlignment: { Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    l10n: { t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[i])) },
    commands: {
        registerCommand(id, handler) { registered.set(id, handler); return nothing(); },
        executeCommand: async () => undefined
    },
    window: {
        state: { focused: true },
        activeTerminal: undefined,
        terminals: [],
        createOutputChannel: () => ({ appendLine() {}, append() {}, dispose() {} }),
        createStatusBarItem: () => statusBar,
        showInformationMessage: async (message) => { shown.info.push(message); },
        showErrorMessage: async () => undefined,
        showWarningMessage: async (message, ...rest) => { shown.warning.push(message); return warningAnswer; },
        showQuickPick: async (items) => { quickPickItems = items; return quickPickAnswer; },
        onDidChangeWindowState: nothing,
        onDidStartTerminalShellExecution: nothing,
        onDidEndTerminalShellExecution: nothing,
        onDidCloseTerminal: nothing
    },
    workspace: {
        workspaceFolders: [],
        onDidChangeConfiguration: nothing,
        getConfiguration(section) {
            const full = (key) => `${section}.${key}`;
            return {
                get(key, fallback) {
                    accessed.add(full(key));
                    return full(key) in properties ? properties[full(key)].default : fallback;
                },
                inspect(key) {
                    accessed.add(full(key));
                    return { defaultValue: properties[full(key)]?.default };
                },
                async update(key, value, target) { updates.push({ key: full(key), value, target }); }
            };
        }
    }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscodeMock : originalLoad.call(this, request, ...rest);
};
const extension = require('../out/extension');
const settings = require('../out/settings');
Module._load = originalLoad;

const context = {
    extensionPath: 'C:\\ext',
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => undefined }
};
extension.activate(context);

test('the extension registers exactly the commands declared in package.json', () => {
    const declared = pkg.contributes.commands.map((c) => c.command).sort();
    assert.deepEqual([...registered.keys()].sort(), declared);
});

test('every keybinding targets a declared command', () => {
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const binding of pkg.contributes.keybindings) {
        assert.ok(declared.has(binding.command), `${binding.command} is not a declared command`);
    }
});

test('the status bar starts "off" and toggles the overlay', () => {
    assert.equal(statusBar.text, '$(circle-slash) Whip off');
    assert.equal(statusBar.command, 'virtualWhip.toggleOverlay');
});

test('every setting the extension reads is declared in package.json', () => {
    settings.readWhipConfig('C:\\ext', undefined);
    settings.readSendOptions();
    settings.showOnlyWhenFocused();
    for (const name of accessed) {
        assert.ok(name in properties, `${name} is read by the code but not declared in package.json`);
    }
});

test('the "show the whip first" message quotes the real command title', async () => {
    await registered.get('virtualWhip.crackNow')();
    assert.equal(shown.info.length, 1);
    assert.ok(
        shown.info[0].includes(`${en['command.category']}: ${en['command.toggleOverlay.title']}`),
        `message does not quote the command title: ${shown.info[0]}`
    );
});

test('"Choose a Style" lists every built-in style and applies the selection', async () => {
    quickPickAnswer = undefined;
    await registered.get('virtualWhip.choosePreset')();
    assert.equal(quickPickItems.length, properties['virtualWhip.appearance.preset'].enum.length);
    assert.deepEqual(quickPickItems.map((i) => i.name), properties['virtualWhip.appearance.preset'].enum);
    assert.equal(quickPickItems[0].label, 'Leather');
    assert.equal(quickPickItems[0].description, '(current)');
    assert.equal(updates.length, 0, 'cancelling must not change anything');

    quickPickAnswer = quickPickItems[1];
    await registered.get('virtualWhip.choosePreset')();
    assert.deepEqual(updates.at(-1), { key: 'virtualWhip.appearance.preset', value: quickPickItems[1].name, target: 1 });
});

test('"Reset Appearance" asks for confirmation before doing anything', async () => {
    updates.length = 0;
    warningAnswer = undefined;
    await registered.get('virtualWhip.resetAppearance')();
    assert.equal(shown.warning.length, 1);
    assert.equal(updates.length, 0, 'declining must not change anything');
});

test('the extension deactivates cleanly', () => {
    assert.doesNotThrow(() => extension.deactivate());
});
