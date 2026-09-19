// Tests of src/protocol.ts and src/messages.ts: every line the overlay can print is understood
// (or rejected) the same way, whatever the way the text arrives in chunks.
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const { parseOverlayLine, encodeConfigCommand, LineSplitter } = require('../out/protocol');
const { DEFAULT_MESSAGES, resolveMessages } = require('../out/messages');

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

// A message with accents and an emoji, built from code points: this file must stay ASCII (French
// text belongs to the French translation files, and a test checks it).
const E_ACUTE = String.fromCharCode(0xe9);
const E_CIRC = String.fromCharCode(0xea);
const ACCENTED = `D${E_ACUTE}p${E_CIRC}che-toi (sans te pr${E_ACUTE}cipiter) !`;
const HORSE = String.fromCodePoint(0x1f40e);

// ---------- Overlay lines ----------

test('OVERLAY_READY', () => {
    assert.deepEqual(parseOverlayLine('OVERLAY_READY'), { type: 'ready' });
});

test('anchor positions are plain decimals, two of them', () => {
    assert.deepEqual(parseOverlayLine('WHIP_ANCHOR:0.5,0.25'), { type: 'anchor', x: 0.5, y: 0.25 });
    assert.deepEqual(parseOverlayLine('WHIP_ANCHOR:1,0'), { type: 'anchor', x: 1, y: 0 });
    for (const bad of ['WHIP_ANCHOR:', 'WHIP_ANCHOR:1', 'WHIP_ANCHOR:1,2,3', 'WHIP_ANCHOR:a,b', 'WHIP_ANCHOR:,',
        'WHIP_ANCHOR:0x10,1', 'WHIP_ANCHOR:1e3,1', 'WHIP_ANCHOR:NaN,1', 'WHIP_ANCHOR: 1,2']) {
        assert.equal(parseOverlayLine(bad).type, 'invalid', bad);
    }
});

test('a crack message survives the base64 round trip, accents and emoji included', () => {
    for (const text of ['Come on, faster!', ACCENTED, `${HORSE} go`, 'two\nlines', "We don't have all day"]) {
        assert.deepEqual(parseOverlayLine(`WHIP_MESSAGE:${b64(text)}`), { type: 'message', text });
    }
});

test('a message that is not valid base64, or empty, is rejected instead of sending garbage', () => {
    for (const bad of ['WHIP_MESSAGE:', 'WHIP_MESSAGE:not base64!', 'WHIP_MESSAGE:%%%', `WHIP_MESSAGE:${b64('   ')}`, 'WHIP_MESSAGE:=']) {
        assert.equal(parseOverlayLine(bad).type, 'invalid', bad);
    }
});

test('any other line is a log line', () => {
    assert.deepEqual(parseOverlayLine('[overlay] crack triggered'), { type: 'log', text: '[overlay] crack triggered' });
    assert.equal(parseOverlayLine('').type, 'log');
    // a prefix must be at the start: a log line that merely mentions the protocol is not an event
    assert.equal(parseOverlayLine('[overlay] sent WHIP_MESSAGE:abcd').type, 'log');
});

// ---------- Chunks ----------

test('lines are rebuilt from chunks cut anywhere, LF or CRLF', () => {
    const splitter = new LineSplitter();
    assert.deepEqual(splitter.push('OVERLAY_R'), []);
    assert.deepEqual(splitter.push('EADY\nWHIP_A'), ['OVERLAY_READY']);
    assert.deepEqual(splitter.push('NCHOR:1,2\r'), []);
    assert.deepEqual(splitter.push('\n[overlay] a\r\n[overlay] b\n'), ['WHIP_ANCHOR:1,2', '[overlay] a', '[overlay] b']);
    assert.deepEqual(splitter.push(''), []);
});

test('the unfinished line of a dead process is dropped on reset', () => {
    const splitter = new LineSplitter();
    splitter.push('WHIP_MESSAGE:abc');
    splitter.reset();
    assert.deepEqual(splitter.push('OVERLAY_READY\n'), ['OVERLAY_READY']);
});

// ---------- Commands sent to the overlay ----------

test('CONFIG is one line whose payload decodes back to the configuration', () => {
    const config = { sensitivity: 3.5, messages: [ACCENTED, HORSE], appearance: { whip: { colorBase: '#785032' } } };
    const command = encodeConfigCommand(config);
    assert.ok(command.startsWith('CONFIG:'));
    assert.ok(!/[\r\n]/.test(command), 'one command per line');
    assert.deepEqual(JSON.parse(Buffer.from(command.slice('CONFIG:'.length), 'base64').toString('utf8')), config);
});

// ---------- Messages ----------

test('the built-in messages are exactly the default of virtualWhip.messages', () => {
    const declared = Object.assign({}, ...pkg.contributes.configuration.map((s) => s.properties))['virtualWhip.messages'].default;
    assert.deepEqual([...DEFAULT_MESSAGES], declared);
});

test('the user list wins; a missing, empty or blank list means the built-in messages, translated', () => {
    assert.deepEqual(resolveMessages(['a', 'b']), ['a', 'b']);
    assert.deepEqual(resolveMessages(['a', '  ', '', 'b']), ['a', 'b']);
    assert.deepEqual(resolveMessages(['a', 42, null, {}]), ['a'], 'anything that is not text is ignored');

    const shout = (text) => text.toUpperCase();
    const translated = DEFAULT_MESSAGES.map(shout);
    assert.deepEqual(resolveMessages(undefined, shout), translated);
    assert.deepEqual(resolveMessages([], shout), translated);
    assert.deepEqual(resolveMessages(['  '], shout), translated);
    assert.deepEqual(resolveMessages(['mine'], shout), ['mine'], 'the user\'s own text is never translated');
    assert.deepEqual(resolveMessages(undefined), [...DEFAULT_MESSAGES]);
});
