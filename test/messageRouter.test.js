// Tests of src/messageRouter.ts with a fake "vscode" module and a fake clock: which terminal or
// chat a message goes to, the exact keys typed (Escape, /effort, draft protection), the order of
// concurrent sends, and what the user is told when nothing can be delivered.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const en = require('../package.nls.json');

const state = {};
const listeners = {};
const fireStart = (terminal, commandLine) =>
    listeners.start.forEach((fn) => fn({ terminal, execution: { commandLine: { value: commandLine } } }));

const vscodeMock = {
    version: '1.138.0',
    l10n: { t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[i])) },
    window: {
        get activeTerminal() { return state.activeTerminal; },
        get terminals() { return state.terminals; },
        onDidStartTerminalShellExecution: (fn) => { listeners.start.push(fn); return { dispose() {} }; },
        onDidEndTerminalShellExecution: (fn) => { listeners.end.push(fn); return { dispose() {} }; },
        onDidCloseTerminal: (fn) => { listeners.close.push(fn); return { dispose() {} }; },
        showInformationMessage: async (message) => { state.infos.push(message); }
    },
    commands: {
        executeCommand: async (id, arg) => { state.calls.push({ id, arg }); return state.executeImpl(id, arg); },
        getCommands: async () => state.commands
    },
    extensions: { getExtension: (id) => state.extensions[id] },
    workspace: {
        getConfiguration: (section) => ({
            get: (key, fallback) => (`${section}.${key}` in state.config ? state.config[`${section}.${key}`] : fallback)
        })
    }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscodeMock : originalLoad.call(this, request, ...rest);
};
const { MessageRouter } = require('../out/messageRouter');
Module._load = originalLoad;

const ESC = '\x1b', CTRL_E = '\x05', CTRL_U = '\x15', CTRL_Y = '\x19', BACKSPACE = '\x7f';

// `{ shellIntegration: undefined }` = a terminal without shell integration (cmd.exe...).
function terminal(name, options = {}) {
    const shellIntegration = 'shellIntegration' in options ? options.shellIntegration : {};
    return { name, exitStatus: undefined, shellIntegration, sent: [], sendText(text, newLine) { this.sent.push([text, newLine]); } };
}

/** A fresh world: no terminal, an instantaneous clock that records the delays it was asked for. */
function setup() {
    Object.assign(state, {
        terminals: [], activeTerminal: undefined, infos: [], calls: [], extensions: {}, config: {},
        commands: ['workbench.action.chat.submit'], executeImpl: async () => undefined
    });
    Object.assign(listeners, { start: [], end: [], close: [] });
    const log = [];
    const clock = { t: 1_000_000, sleeps: [], sleep: async (ms) => { clock.sleeps.push(ms); clock.t += ms; }, now: () => clock.t };
    const router = new MessageRouter({ appendLine: (line) => log.push(line) }, clock);
    return { router, clock, log };
}

const opts = (overrides = {}) => ({
    target: 'auto', interrupt: true, interruptDelayMs: 200, reasoningEffort: 'unchanged', preserveDraft: false, ...overrides
});

/** A terminal where a `claude` command was started, and which is the active one. */
function claudeTerminal(name = 'pwsh') {
    const term = terminal(name);
    state.terminals.push(term);
    state.activeTerminal = term;
    fireStart(term, 'claude');
    return term;
}

// ---------- Terminal delivery ----------

test('a message goes to the terminal where a claude command was started: Escape, the text, then Enter alone', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    router.send('Faster!', opts());
    await router.idle();
    assert.deepEqual(term.sent, [[ESC, false], ['Faster!', false], ['', true]]);
    assert.equal(state.calls.length, 0, 'the chat must not be touched');
});

test('the claude command is recognized in its usual forms, and only those', async () => {
    const { router } = setup();
    for (const [commandLine, expected] of [
        ['claude', true], ['claude --resume', true], ['claude.exe', true], ['C:\\tools\\claude.cmd -p "x"', true],
        ['"claude" --model opus', true], ['echo claudette', false], ['npm run claude-build', false], ['git status', false]
    ]) {
        const term = terminal('t');
        state.terminals = [term];
        state.activeTerminal = term;
        fireStart(term, commandLine);
        router.send('x', opts({ interrupt: false }));
        await router.idle();
        assert.equal(term.sent.length > 0, expected, commandLine);
        state.calls.length = 0;
    }
});

test('a terminal whose name contains "claude" is used without any detection', async () => {
    const { router } = setup();
    const term = terminal('Claude Code');
    state.terminals = [term];
    state.activeTerminal = term;
    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.deepEqual(term.sent, [['x', false], ['', true]]);
});

test('Escape is never sent twice within 1.5 s (that would trigger "rewind"), but is again later', async () => {
    const { router, clock } = setup();
    const term = claudeTerminal();
    router.send('one', opts());
    router.send('two', opts());
    await router.idle();
    assert.deepEqual(term.sent.map(([text]) => text), [ESC, 'one', '', 'two', '']);

    clock.t += 2000;
    term.sent.length = 0;
    router.send('three', opts());
    await router.idle();
    assert.equal(term.sent[0][0], ESC);
});

test('without interruptBeforeSend no Escape is sent', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.deepEqual(term.sent, [['x', false], ['', true]]);
});

test('/effort is typed once per terminal, and again when the level changes', async () => {
    const { router, clock } = setup();
    const term = claudeTerminal();
    const texts = () => term.sent.map(([text]) => text).filter((text) => text !== '' && text !== ESC);

    router.send('a', opts({ interrupt: false, reasoningEffort: 'low' }));
    router.send('b', opts({ interrupt: false, reasoningEffort: 'low' }));
    await router.idle();
    assert.deepEqual(texts(), ['/effort low', 'a', 'b']);

    router.send('c', opts({ interrupt: false, reasoningEffort: 'high' }));
    await router.idle();
    assert.deepEqual(texts().slice(3), ['/effort high', 'c']);

    term.sent.length = 0;
    router.send('d', opts({ interrupt: false, reasoningEffort: 'unchanged' }));
    await router.idle();
    assert.deepEqual(texts(), ['d'], 'unchanged must not type anything');
    assert.ok(clock.sleeps.includes(500), 'the effort command is given time to settle');
});

test('sends never interleave: a second crack waits for the first sequence to finish', async () => {
    const { router, clock } = setup();
    const term = claudeTerminal();
    const gates = [];
    clock.sleep = (ms) => new Promise((resolve) => gates.push(resolve));
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    router.send('first', opts());
    router.send('second', opts());
    await settle();
    assert.deepEqual(term.sent.map(([text]) => text), [ESC], 'the first send is waiting after Escape, the second has not started');

    while (term.sent.length < 5) {
        gates.shift()?.();
        await settle();
    }
    assert.deepEqual(term.sent.map(([text]) => text), [ESC, 'first', '', 'second', '']);
});

// ---------- Choosing the terminal ----------

test('the active Claude terminal is preferred over an older one', async () => {
    const { router } = setup();
    const older = claudeTerminal('older');
    const newer = claudeTerminal('newer');
    state.activeTerminal = older;
    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.equal(older.sent.length, 2);
    assert.equal(newer.sent.length, 0);
});

test('when the active terminal is not Claude, the last Claude terminal is used, then any other', async () => {
    const { router } = setup();
    const claude = claudeTerminal('claude-here');
    const plain = terminal('plain');
    state.terminals.push(plain);
    state.activeTerminal = plain;
    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.equal(claude.sent.length, 2);
    assert.equal(plain.sent.length, 0);

    listeners.close.forEach((fn) => fn(claude));
    state.terminals = [plain, terminal('Claude second')];
    router.send('y', opts({ interrupt: false }));
    await router.idle();
    assert.equal(state.terminals[1].sent.length, 2, 'falls back on a terminal recognized by its name');
    assert.equal(plain.sent.length, 0);
});

test('a terminal that closed, or where claude ended, is forgotten', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    listeners.end.forEach((fn) => fn({ terminal: term }));
    listeners.close.forEach((fn) => fn(term));
    state.terminals = [];
    state.activeTerminal = undefined;
    router.send('x', opts());
    await router.idle();
    assert.equal(term.sent.length, 0);
    assert.equal(state.calls.length, 1, 'goes to the chat instead');
});

test('target "claude" trusts the active terminal when nothing was detected; "auto" does not', async () => {
    const claude = setup();
    const plain = terminal('plain');
    state.terminals = [plain];
    state.activeTerminal = plain;
    claude.router.send('x', opts({ target: 'claude', interrupt: false }));
    await claude.router.idle();
    assert.equal(plain.sent.length, 2);
    assert.equal(state.calls.length, 0);

    // (a fresh router: once a terminal has been used it is remembered as the last Claude terminal)
    const auto = setup();
    const other = terminal('plain');
    state.terminals = [other];
    state.activeTerminal = other;
    auto.router.send('y', opts({ target: 'auto', interrupt: false }));
    await auto.router.idle();
    assert.equal(other.sent.length, 0);
    assert.equal(state.calls.length, 1);
});

test('target "claude" with no terminal at all says so (once in 30 s) and does not touch the chat', async () => {
    const { router, clock } = setup();
    router.send('x', opts({ target: 'claude' }));
    router.send('y', opts({ target: 'claude' }));
    await router.idle();
    assert.equal(state.calls.length, 0);
    assert.equal(state.infos.length, 1);
    assert.match(state.infos[0], /no Claude Code terminal found/);

    clock.t += 31_000;
    router.send('z', opts({ target: 'claude' }));
    await router.idle();
    assert.equal(state.infos.length, 2, 'the hint comes back after the throttle delay');
});

test('target "copilot" never types into a terminal, even a Claude one', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    router.send('x', opts({ target: 'copilot' }));
    await router.idle();
    assert.equal(term.sent.length, 0);
    assert.equal(state.calls.length, 1);
});

// ---------- Marking a terminal by hand (shells without shell integration) ----------

test('"Use This Terminal for Claude Code" makes an undetectable terminal a target, and toggles back', async () => {
    const { router } = setup();
    const cmd = terminal('cmd', { shellIntegration: undefined });
    state.terminals = [cmd];
    state.activeTerminal = cmd;

    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.equal(cmd.sent.length, 0, 'not detected: auto goes to the chat');
    assert.equal(state.calls.length, 1);

    assert.equal(router.toggleMarkedTerminal(cmd), true);
    router.send('y', opts({ interrupt: false }));
    await router.idle();
    assert.deepEqual(cmd.sent, [['y', false], ['', true]]);

    assert.equal(router.toggleMarkedTerminal(cmd), false);
    cmd.sent.length = 0;
    state.calls.length = 0;
    router.send('z', opts({ interrupt: false }));
    await router.idle();
    assert.equal(cmd.sent.length, 0, 'unmarked: not a target any more, even as the last one used');
    assert.equal(state.calls.length, 1);
});

test('closing a marked terminal drops the mark', async () => {
    const { router } = setup();
    const cmd = terminal('cmd', { shellIntegration: undefined });
    state.terminals = [cmd];
    router.toggleMarkedTerminal(cmd);
    listeners.close.forEach((fn) => fn(cmd));
    state.activeTerminal = cmd;
    router.send('x', opts({ interrupt: false }));
    await router.idle();
    assert.equal(cmd.sent.length, 0);
});

// ---------- Copilot chat ----------

test('the chat receives the message with "stop and send" and without touching the draft', async () => {
    const { router } = setup();
    router.send('Hurry', opts());
    await router.idle();
    assert.deepEqual(state.calls, [{
        id: 'workbench.action.chat.submit',
        arg: { inputValue: 'Hurry', acceptInputOptions: { cancelCurrentRequest: true, preserveFocus: true, preserveInput: true } }
    }]);

    router.send('Hurry', opts({ interrupt: false }));
    await router.idle();
    assert.equal(state.calls[1].arg.acceptInputOptions.cancelCurrentRequest, false);
});

test('when the chat command fails (removed or changed in a later VS Code) the user is told, and the next send still works', async () => {
    const { router, log } = setup();
    state.executeImpl = async () => { throw new Error("command 'workbench.action.chat.submit' not found"); };
    router.send('x', opts());
    router.send('y', opts());
    await router.idle();
    assert.equal(state.calls.length, 2, 'the second send was still attempted');
    assert.equal(state.infos.length, 1, 'one hint, not one per crack');
    assert.match(state.infos[0], /sending to Copilot chat failed \(command 'workbench\.action\.chat\.submit' not found\)/);
    assert.ok(log.some((line) => line.includes('VS Code 1.138.0')), 'the log names the VS Code version');

    state.executeImpl = async () => undefined;
    router.send('z', opts());
    await router.idle();
    assert.equal(state.calls.length, 3);
});

// ---------- Explaining a fallback to the chat ----------

test('auto falls back to the chat: a terminal without shell integration explains why, once', async () => {
    const { router } = setup();
    state.terminals = [terminal('cmd', { shellIntegration: undefined })];
    router.send('x', opts());
    router.send('y', opts());
    await router.idle();
    assert.equal(state.calls.length, 2);
    assert.equal(state.infos.length, 1);
    const command = `${en['command.category']}: ${en['command.markClaudeTerminal.title']}`;
    assert.ok(state.infos[0].includes(`"${command}"`), `the hint must quote the real command title: ${state.infos[0]}`);
});

test('auto falls back to the chat: no hint when every terminal has shell integration, or for the "copilot" target', async () => {
    const { router } = setup();
    state.terminals = [terminal('pwsh')];
    router.send('x', opts());
    await router.idle();
    assert.equal(state.infos.length, 0);

    state.terminals = [terminal('cmd', { shellIntegration: undefined })];
    router.send('y', opts({ target: 'copilot' }));
    await router.idle();
    assert.equal(state.infos.length, 0, 'the user chose Copilot: nothing to explain');
});

test('the Claude Code chat panel cannot be driven: explained when there is no Copilot to fall back on', async () => {
    const { router } = setup();
    state.extensions['anthropic.claude-code'] = {};
    state.config['claudeCode.useTerminal'] = false;
    router.send('x', opts());
    await router.idle();
    assert.equal(state.infos.length, 1);
    assert.match(state.infos[0], /claudeCode\.useTerminal/);

    const withCopilot = setup();
    state.extensions['anthropic.claude-code'] = {};
    state.extensions['GitHub.copilot-chat'] = {};
    state.config['claudeCode.useTerminal'] = false;
    withCopilot.router.send('x', opts());
    await withCopilot.router.idle();
    assert.equal(state.infos.length, 0, 'Copilot is installed: the fallback is plausible, no popup');
});

test('target "claude" with the Claude Code panel in use points to claudeCode.useTerminal', async () => {
    const { router } = setup();
    state.extensions['anthropic.claude-code'] = {};
    state.config['claudeCode.useTerminal'] = false;
    router.send('x', opts({ target: 'claude' }));
    await router.idle();
    assert.match(state.infos[0], /claudeCode\.useTerminal/);
});

test('with claudeCode.useTerminal on, the Claude Code extension is not mistaken for the panel', async () => {
    const { router } = setup();
    state.extensions['anthropic.claude-code'] = {};
    state.config['claudeCode.useTerminal'] = true;
    router.send('x', opts({ target: 'claude' }));
    await router.idle();
    assert.match(state.infos[0], /no Claude Code terminal found/);
});

// ---------- Protecting what the user is typing (opt-in) ----------

test('draft protection: end of line, a marker, delete-to-start; then the message; then paste back and remove the marker', async () => {
    const { router, clock } = setup();
    const term = claudeTerminal();
    router.send('Faster!', opts({ preserveDraft: true }));
    await router.idle();
    assert.deepEqual(term.sent, [
        [ESC, false],
        [CTRL_E, false], ['~', false], [CTRL_U, false],
        ['Faster!', false], ['', true],
        [CTRL_Y, false], [BACKSPACE, false]
    ]);
    // interrupt delay, three key gaps, submit delay, the wait for the message to leave, one key gap
    assert.deepEqual(clock.sleeps, [200, 40, 40, 40, 120, 400, 40]);
});

test('draft protection is off by default: no editing key is ever typed', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    router.send('x', opts({ preserveDraft: false }));
    await router.idle();
    const typed = term.sent.map(([text]) => text).join('');
    for (const key of [CTRL_E, CTRL_U, CTRL_Y, BACKSPACE, '~']) {
        assert.ok(!typed.includes(key), `unexpected key ${JSON.stringify(key)}`);
    }
});

test('draft protection: the draft is set aside before /effort and restored after the message', async () => {
    const { router } = setup();
    const term = claudeTerminal();
    router.send('go', opts({ interrupt: false, preserveDraft: true, reasoningEffort: 'low' }));
    await router.idle();
    assert.deepEqual(term.sent.map(([text]) => text), [
        CTRL_E, '~', CTRL_U, '/effort low', '', 'go', '', CTRL_Y, BACKSPACE
    ]);
});

test('draft protection only concerns the Claude Code terminal, never the chat', async () => {
    const { router } = setup();
    router.send('x', opts({ preserveDraft: true }));
    await router.idle();
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].arg.inputValue, 'x');
});

// ---------- Diagnostics ----------

test('diagnose lists what the router sees and where a crack would go', async () => {
    const { router } = setup();
    state.terminals = [terminal('cmd', { shellIntegration: undefined }), terminal('pwsh')];
    state.activeTerminal = state.terminals[1];
    fireStart(state.terminals[1], 'claude');
    state.commands = [];
    state.extensions['anthropic.claude-code'] = {};
    state.config['claudeCode.useTerminal'] = false;

    const report = (await router.diagnose('auto')).join('\n');
    assert.match(report, /VS Code 1\.138\.0/);
    assert.match(report, /"cmd": not Claude Code, NO shell integration/);
    assert.match(report, /"pwsh": detected \(claude command\), shell integration on/);
    assert.match(report, /workbench\.action\.chat\.submit: MISSING/);
    assert.match(report, /Copilot Chat extension: not installed/);
    assert.match(report, /Claude Code extension: installed, chat panel in use/);
    assert.match(report, /A crack would go to: terminal "pwsh"/);

    state.commands = ['workbench.action.chat.submit'];
    state.activeTerminal = undefined;
    listeners.close.forEach((fn) => fn(state.terminals[1]));
    state.terminals = [];
    const empty = (await router.diagnose('auto')).join('\n');
    assert.match(empty, /workbench\.action\.chat\.submit: available/);
    assert.match(empty, /A crack would go to: Copilot chat/);
    assert.match((await router.diagnose('claude')).join('\n'), /A crack would go to: nowhere/);
});
