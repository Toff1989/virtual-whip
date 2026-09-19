// Tests of the real native overlay (overlay/bin/WhipOverlay.exe): its built-in checks, the PNG
// rendering, and the stdin/stdout protocol on a real process. Windows only; skipped when the
// overlay has not been built (npm run compile). The whip is never SHOWn here, so no window ever
// appears on the screen of whoever runs the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exe = path.join(__dirname, '..', 'overlay', 'bin', 'WhipOverlay.exe');
const skip = process.platform !== 'win32' ? 'the overlay is Windows only'
    : !fs.existsSync(exe) ? 'the overlay is not built (npm run compile)' : false;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-overlay-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

// ---------- Built-in checks ----------

test('the overlay passes its own checks (gesture detection, colors, live configuration)', { skip }, () => {
    const result = cp.spawnSync(exe, ['--selftest'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, `--selftest failed:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /^SELFTEST OK \d+\s*$/m);
});

// ---------- PNG rendering (no window) ----------

function snapshot(name, config, size = '320x180') {
    const file = path.join(work, `${name}.png`);
    const result = cp.spawnSync(exe, ['--snapshot', file, '--size', size], {
        env: { ...process.env, WHIP_CONFIG: JSON.stringify(config) }, timeout: 20_000
    });
    assert.equal(result.status, 0, `--snapshot failed: ${fs.existsSync(`${file}.err`) ? fs.readFileSync(`${file}.err`, 'utf8') : ''}`);
    return fs.readFileSync(file);
}

test('--snapshot draws a PNG of the requested size, without any window', { skip }, () => {
    const png = snapshot('default', {});
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    assert.equal(png.readUInt32BE(16), 320, 'width');
    assert.equal(png.readUInt32BE(20), 180, 'height');
});

test('--snapshot follows the configuration it is given, and survives a broken one', { skip }, () => {
    const plain = snapshot('plain', {});
    const red = snapshot('red', { appearance: { whip: { colorBase: '#ff0000', colorTip: '#ff0000', thickness: 14 } } });
    const thick = snapshot('thick', { appearance: { whip: { thickness: 20 } } });
    assert.notDeepEqual(plain, red);
    assert.notDeepEqual(plain, thick);
    assert.deepEqual(snapshot('again', {}), plain, 'the rendering is deterministic');

    const file = path.join(work, 'broken.png');
    const result = cp.spawnSync(exe, ['--snapshot', file], { env: { ...process.env, WHIP_CONFIG: '{not json' }, timeout: 20_000 });
    assert.equal(result.status, 0, 'a broken WHIP_CONFIG falls back on the defaults');
    assert.ok(fs.existsSync(file));
});

// ---------- Protocol on a real process ----------

/** Starts the overlay and gives a way to wait for a line of its output. */
function launch(config) {
    const child = cp.spawn(exe, [], { env: { ...process.env, WHIP_CONFIG: JSON.stringify(config) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = [];
    const waiters = [];
    let rest = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        const parts = (rest + chunk).split(/\r?\n/);
        rest = parts.pop();
        for (const line of parts) {
            lines.push(line);
            waiters.slice().forEach((waiter) => waiter.check());
        }
    });
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    const waitFor = (pattern, ms = 10_000) => new Promise((resolve, reject) => {
        const waiter = {
            check() {
                const found = lines.find((line) => pattern.test(line));
                if (found !== undefined) { clearTimeout(timer); waiters.splice(waiters.indexOf(waiter), 1); resolve(found); }
            }
        };
        const timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`no line matching ${pattern} within ${ms} ms; output so far:\n${lines.join('\n')}`));
        }, ms);
        waiters.push(waiter);
        waiter.check();
    });
    return { child, lines, waitFor, exited, send: (text) => child.stdin.write(`${text}\n`) };
}

test('a real overlay announces itself, reports its state, takes live configuration, and quits on request', { skip }, async () => {
    const overlay = launch({ messages: ['x'], sensitivity: 5, appearance: { whip: { thickness: 9 } } });
    try {
        await overlay.waitFor(/^OVERLAY_READY$/);

        overlay.send('STATUS');
        const status = await overlay.waitFor(/^\[overlay\] status /);
        assert.match(status, /visible=False/, 'starts hidden: nothing is drawn until SHOW');
        assert.match(status, /sensitivity=5 /);
        assert.match(status, /modifier=none/);
        assert.match(status, /thickness=9 /);

        overlay.send(`CONFIG:${b64(JSON.stringify({ sensitivity: 9, gestureModifier: 'shift', messages: ['a', 'b', 'c'], appearance: { whip: { thickness: 4 } } }))}`);
        const updated = await overlay.waitFor(/^\[overlay\] config updated: /);
        assert.match(updated, /sensitivity=9 modifier=shift .*messages=3 thickness=4 /);

        overlay.send('CONFIG:@@@not base64');
        await overlay.waitFor(/^\[overlay\] invalid CONFIG command/);
        overlay.send(`CONFIG:${b64('[1, 2]')}`);
        await overlay.waitFor(/^\[overlay\] invalid CONFIG command: the configuration is not a JSON object/);

        overlay.send('NONSENSE');
        overlay.send('CRACK'); // hidden: nothing may come out of it
        overlay.send('STATUS');
        await overlay.waitFor(/^\[overlay\] status .*sensitivity=9 /); // still alive, and the invalid CONFIGs changed nothing
        assert.ok(!overlay.lines.some((line) => line.startsWith('WHIP_MESSAGE:')), 'a hidden whip does not crack');

        overlay.send('QUIT');
        assert.equal(await overlay.exited, 0);
    } finally {
        overlay.child.kill();
    }
});

test('an overlay whose extension has gone (stdin closed) stops by itself', { skip }, async () => {
    const overlay = launch({});
    try {
        await overlay.waitFor(/^OVERLAY_READY$/);
        overlay.child.stdin.end();
        const code = await Promise.race([
            overlay.exited,
            new Promise((resolve) => setTimeout(() => resolve('still running'), 10_000))
        ]);
        assert.equal(code, 0);
    } finally {
        overlay.child.kill();
    }
});

test('a broken configuration does not prevent the overlay from starting', { skip }, async () => {
    const child = cp.spawn(exe, [], { env: { ...process.env, WHIP_CONFIG: '{oops' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    try {
        const output = await new Promise((resolve, reject) => {
            let text = '';
            const timer = setTimeout(() => reject(new Error(`no OVERLAY_READY:\n${text}`)), 10_000);
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                text += chunk;
                if (text.includes('OVERLAY_READY')) { clearTimeout(timer); resolve(text); }
            });
        });
        assert.match(output, /invalid WHIP_CONFIG/);
    } finally {
        child.kill();
    }
});
