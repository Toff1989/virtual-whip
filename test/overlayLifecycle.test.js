// Tests of the life of the overlay process: src/extension.ts + src/sidecarManager.ts driven with a
// fake "vscode", a fake child process and a simulated clock. What is checked: a burst of settings
// changes ends in ONE restart that uses the LAST values; appearance-type settings reach the
// running overlay without any restart; the status bar stays right; and a crack printed by the
// overlay ends up in the chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const pkg = require('../package.json');

const properties = Object.assign({}, ...pkg.contributes.configuration.map((section) => section.properties));

// The sidecar only starts on Windows: pretend to be there, whatever runs the tests.
Object.defineProperty(process, 'platform', { value: 'win32' });
const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-lifecycle-'));
fs.mkdirSync(path.join(extensionPath, 'overlay', 'bin'), { recursive: true });
fs.writeFileSync(path.join(extensionPath, 'overlay', 'bin', 'WhipOverlay.exe'), '');
test.after(() => fs.rmSync(extensionPath, { recursive: true, force: true }));

// ---------- Fakes ----------

const world = {};
const nothing = () => ({ dispose() {} });

function fakeChild() {
    const child = new EventEmitter();
    child.pid = 4000 + world.spawns.length;
    child.killed = false;
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdin = { written: [], write(text) { this.written.push(text); return true; }, on() {} };
    child.kill = () => {
        child.killed = true;
        setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    };
    return child;
}

const fakeChildProcess = {
    spawn(exe, args, options) {
        const child = fakeChild();
        world.spawns.push({ child, config: JSON.parse(options.env.WHIP_CONFIG) });
        return child;
    }
};

const vscodeMock = {
    version: '1.138.0',
    StatusBarAlignment: { Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    l10n: { t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[i])) },
    commands: {
        registerCommand(id, handler) { world.commands.set(id, handler); return nothing(); },
        executeCommand: async (id, arg) => { world.chatCalls.push({ id, arg }); },
        getCommands: async () => []
    },
    extensions: { getExtension: () => undefined },
    window: {
        state: { focused: true },
        activeTerminal: undefined,
        terminals: [],
        createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
        createStatusBarItem: () => world.statusBar,
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showQuickPick: async () => undefined,
        onDidChangeWindowState: nothing,
        onDidStartTerminalShellExecution: nothing,
        onDidEndTerminalShellExecution: nothing,
        onDidCloseTerminal: nothing
    },
    workspace: {
        workspaceFolders: [],
        onDidChangeConfiguration(handler) { world.configHandlers.push(handler); return nothing(); },
        getConfiguration(section) {
            const name = (key) => `${section}.${key}`;
            return {
                get: (key, fallback) => (name(key) in world.settings ? world.settings[name(key)]
                    : name(key) in properties ? properties[name(key)].default : fallback),
                inspect: (key) => ({ defaultValue: properties[name(key)]?.default, globalValue: world.settings[name(key)] }),
                update: async () => undefined
            };
        }
    }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeMock;
    if (request === 'child_process') return fakeChildProcess;
    return originalLoad.call(this, request, ...rest);
};
const extension = require('../out/extension');
Module._load = originalLoad;

const { mock } = test;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const emit = (child, text) => child.stdout.emit('data', text);

/** Announces changed settings like VS Code does: `affectsConfiguration` is true for a key and its parents. */
async function change(...keys) {
    const event = {
        affectsConfiguration: (query) => keys.some((key) => {
            const full = `virtualWhip.${key}`;
            return query === 'virtualWhip' || full === query || full.startsWith(`${query}.`) || query.startsWith(`${full}.`);
        })
    };
    for (const handler of world.configHandlers) await handler(event);
}

/** A fresh extension, the overlay started, ready, and showing. */
async function started(settings = {}) {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
    Object.assign(world, {
        spawns: [], commands: new Map(), configHandlers: [], chatCalls: [], settings: { ...settings },
        statusBar: { text: '', tooltip: '', command: '', show() {}, dispose() {} },
        anchorSaved: []
    });
    vscodeMock.window.state.focused = true;
    extension.activate({
        extensionPath,
        subscriptions: [],
        globalState: { get: () => undefined, update: async (key, value) => { world.anchorSaved.push(value); } }
    });
    world.commands.get('virtualWhip.toggleOverlay')();
    assert.equal(world.spawns.length, 1);
    emit(world.spawns[0].child, 'OVERLAY_READY\n');
    return world.spawns[0];
}

const writes = (spawned) => spawned.child.stdin.written;
const configCommands = (spawned) => writes(spawned).filter((line) => line.startsWith('CONFIG:'));
const decode = (line) => JSON.parse(Buffer.from(line.slice('CONFIG:'.length).trim(), 'base64').toString('utf8'));

// ---------- Start, show, stop ----------

test('the overlay starts with the current settings, and is shown once it says it is ready', async () => {
    const first = await started({ 'virtualWhip.maxLength': 700, 'virtualWhip.gestureModifier': 'ctrl' });
    assert.equal(first.config.maxLength, 700);
    assert.equal(first.config.gestureModifier, 'ctrl');
    assert.equal(world.statusBar.text, '$(flame) Whip on');
    assert.deepEqual(writes(first), ['SHOW\n']);

    world.commands.get('virtualWhip.toggleOverlay')();
    assert.equal(first.child.killed, true);
    assert.equal(world.statusBar.text, '$(circle-slash) Whip off');
});

test('an unknown gesture modifier in the settings is passed on as "none"', async () => {
    const first = await started({ 'virtualWhip.gestureModifier': 'hyper' });
    assert.equal(first.config.gestureModifier, 'none');
});

// ---------- Restart (settings the overlay only reads at startup) ----------

test('a burst of restart-type changes ends in ONE restart that uses the LAST values', async () => {
    const first = await started();

    world.settings['virtualWhip.maxLength'] = 600;
    await change('maxLength');
    world.settings['virtualWhip.anchorPosition'] = 'top-left';
    await change('anchorPosition');
    world.settings['virtualWhip.sound.volume'] = 50;
    await change('sound.volume');
    assert.equal(first.child.killed, false, 'nothing happens before the debounce delay');

    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    assert.equal(first.child.killed, true, 'the old overlay is stopped');
    assert.equal(world.spawns.length, 1, 'and the new one waits for the old one to release its windows');

    mock.timers.tick(300);
    assert.equal(world.spawns.length, 2);
    const second = world.spawns[1];
    assert.equal(second.config.maxLength, 600);
    assert.equal(second.config.anchorPosition, 'top-left');
    assert.equal(second.config.volume, 50);

    emit(second.child, 'OVERLAY_READY\n');
    assert.deepEqual(writes(second), ['SHOW\n'], 'it is shown again without any action from the user');
    await settle();
    assert.equal(world.statusBar.text, '$(flame) Whip on', 'the status bar says "on" again once it is back');
});

test('a change made while the overlay is restarting is not lost', async () => {
    await started();
    world.settings['virtualWhip.sound.volume'] = 50;
    await change('sound.volume');
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS); // the old overlay is stopped, the new one is not there yet
    await settle();

    world.settings['virtualWhip.sound.volume'] = 10;
    await change('sound.volume');
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS); // the second debounce ends while the restart is under way
    mock.timers.tick(300);
    await settle();
    mock.timers.tick(5000);

    assert.equal(world.spawns.length, 2, 'never a third overlay');
    assert.equal(world.spawns[1].config.volume, 10);
});

test('a mix of appearance and sound settings is one restart, not a restart plus a live update', async () => {
    const first = await started();
    world.settings['virtualWhip.whip.thickness'] = 12;
    await change('whip.thickness');
    world.settings['virtualWhip.audioFilePath'] = 'C:\\sounds\\crack.wav';
    await change('audioFilePath');
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    assert.equal(first.child.killed, true);
    assert.equal(configCommands(first).length, 0);
    mock.timers.tick(300);
    assert.equal(world.spawns[1].config.appearance.whip.thickness, 12);
});

test('a manual toggle during a restart neither doubles nor resurrects the overlay', async () => {
    const first = await started();
    world.settings['virtualWhip.maxLength'] = 800;
    await change('maxLength');
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    assert.equal(first.child.killed, true);

    // the status bar reads "off" during the restart: clicking it starts the whip, which is what it announces
    world.commands.get('virtualWhip.toggleOverlay')();
    assert.equal(world.spawns.length, 2);
    world.commands.get('virtualWhip.toggleOverlay')();
    mock.timers.tick(5000);
    assert.equal(world.spawns.length, 2, 'the pending restart did not start a third overlay');
    assert.equal(world.spawns[1].child.killed, true);
});

test('changing a setting while the whip is off starts nothing', async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
    Object.assign(world, { spawns: [], commands: new Map(), configHandlers: [], chatCalls: [], settings: {}, anchorSaved: [],
        statusBar: { text: '', tooltip: '', command: '', show() {}, dispose() {} } });
    extension.activate({ extensionPath, subscriptions: [], globalState: { get: () => undefined, update: async () => undefined } });
    world.settings['virtualWhip.maxLength'] = 800;
    await change('maxLength');
    world.settings['virtualWhip.whip.thickness'] = 12;
    await change('whip.thickness');
    mock.timers.tick(5000);
    assert.equal(world.spawns.length, 0);
});

// ---------- Live update (settings that need no restart) ----------

test('appearance, sensitivity and messages reach the running overlay without restarting it, in one command', async () => {
    const first = await started();
    world.settings['virtualWhip.appearance.preset'] = 'neon';
    await change('appearance.preset');
    world.settings['virtualWhip.whip.thickness'] = 12;
    await change('whip.thickness');
    world.settings['virtualWhip.sensitivity'] = 8;
    await change('sensitivity');
    world.settings['virtualWhip.messages'] = ['Only this one'];
    await change('messages');
    world.settings['virtualWhip.gestureModifier'] = 'alt';
    await change('gestureModifier');
    assert.equal(configCommands(first).length, 0, 'nothing is sent before the debounce delay');

    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    assert.equal(first.child.killed, false, 'the overlay keeps running: the whip does not flicker');
    assert.equal(world.spawns.length, 1);
    assert.equal(configCommands(first).length, 1, 'four changes, one command');

    const sent = decode(configCommands(first)[0]);
    assert.equal(sent.sensitivity, 8);
    assert.equal(sent.gestureModifier, 'alt');
    assert.deepEqual(sent.messages, ['Only this one']);
    assert.equal(sent.appearance.whip.thickness, 12, 'a setting the user changed wins over the style');
    assert.match(sent.appearance.whip.colorBase, /^#/, 'the rest follows the chosen style');
    assert.ok(writes(first)[writes(first).length - 1].endsWith('\n'), 'one command per line');
});

test('a live change that cannot be delivered (overlay still starting) falls back on a restart', async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
    Object.assign(world, { spawns: [], commands: new Map(), configHandlers: [], chatCalls: [], settings: {}, anchorSaved: [],
        statusBar: { text: '', tooltip: '', command: '', show() {}, dispose() {} } });
    extension.activate({ extensionPath, subscriptions: [], globalState: { get: () => undefined, update: async () => undefined } });
    world.commands.get('virtualWhip.toggleOverlay')(); // started, but no OVERLAY_READY yet
    world.settings['virtualWhip.whip.thickness'] = 15;
    await change('whip.thickness');
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    mock.timers.tick(300);
    assert.equal(world.spawns.length, 2);
    assert.equal(world.spawns[1].config.appearance.whip.thickness, 15);
});

test('changing showOnlyWhenFocused re-applies the visibility at once', async () => {
    const first = await started();
    vscodeMock.window.state.focused = false;
    world.settings['virtualWhip.showOnlyWhenFocused'] = true;
    await change('showOnlyWhenFocused');
    world.settings['virtualWhip.showOnlyWhenFocused'] = false;
    await change('showOnlyWhenFocused');
    assert.deepEqual(writes(first), ['SHOW\n', 'HIDE\n', 'SHOW\n']);
    assert.equal(first.child.killed, false);
});

test('settings only the extension reads (target, interruptBeforeSend...) do nothing to the overlay', async () => {
    const first = await started();
    for (const key of ['target', 'interruptBeforeSend', 'interruptDelayMs', 'reasoningEffort', 'preserveTerminalDraft', 'autoStart']) {
        await change(key);
    }
    mock.timers.tick(5000);
    assert.deepEqual(writes(first), ['SHOW\n']);
    assert.equal(world.spawns.length, 1);
});

test('choosing a corner forgets the position dragged with the mouse, and restarts', async () => {
    const first = await started();
    world.settings['virtualWhip.anchorPosition'] = 'top-right';
    await change('anchorPosition');
    assert.deepEqual(world.anchorSaved, [undefined]);
    mock.timers.tick(extension.CONFIG_DEBOUNCE_MS);
    await settle();
    assert.equal(first.child.killed, true);
});

// ---------- What the overlay says ----------

test('a crack printed by the overlay, even cut in pieces, is delivered to the chat', async () => {
    const first = await started();
    const line = `WHIP_MESSAGE:${Buffer.from('Faster \u{1F40E}', 'utf8').toString('base64')}\n`;
    emit(first.child, line.slice(0, 10));
    emit(first.child, line.slice(10));
    await settle();
    await settle();
    assert.equal(world.chatCalls.length, 1);
    assert.equal(world.chatCalls[0].arg.inputValue, 'Faster \u{1F40E}');
});

test('a garbled crack line is dropped, not sent', async () => {
    const first = await started();
    emit(first.child, 'WHIP_MESSAGE:!!not base64!!\n');
    await settle();
    await settle();
    assert.equal(world.chatCalls.length, 0);
});

test('the anchor position printed by the overlay is remembered', async () => {
    const first = await started();
    emit(first.child, 'WHIP_ANCHOR:0.25,0.75\n');
    assert.deepEqual(world.anchorSaved, [{ x: 0.25, y: 0.75 }]);
    emit(first.child, 'WHIP_ANCHOR:oops\n');
    assert.equal(world.anchorSaved.length, 1);
});

test('when the overlay crashes the status bar says so', async () => {
    const first = await started();
    first.child.killed = false;
    first.child.emit('exit', 1, null);
    assert.equal(world.statusBar.text, '$(circle-slash) Whip off');
});
