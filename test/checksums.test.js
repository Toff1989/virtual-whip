// Tests of scripts/make-checksums.js: the sums published with a release must be the real ones,
// in the format `sha256sum -c` reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256, checksumLines, releaseFiles } = require('../scripts/make-checksums');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-sums-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a checksum is the SHA-256 of the exact bytes of the file', () => {
    const file = path.join(dir, 'known.bin');
    fs.writeFileSync(file, 'abc');
    // the well-known SHA-256 of "abc"
    assert.equal(sha256(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const bytes = crypto.randomBytes(5000);
    fs.writeFileSync(file, bytes);
    assert.equal(sha256(file), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('each line is "<64 hex digits>, two spaces, the file name": the format of sha256sum -c', () => {
    const a = path.join(dir, 'a.vsix');
    const b = path.join(dir, 'b.bat');
    fs.writeFileSync(a, 'one');
    fs.writeFileSync(b, 'two');
    const lines = checksumLines([a, b]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^[0-9a-f]{64} {2}a\.vsix$/);
    assert.match(lines[1], /^[0-9a-f]{64} {2}b\.bat$/);
    assert.notEqual(lines[0].slice(0, 64), lines[1].slice(0, 64));
});

test('a release is the .vsix and the installer, and a missing one is an error, not a silent gap', () => {
    assert.throws(() => releaseFiles(dir, 'virtual-whip', '1.2.3'), /virtual-whip-1\.2\.3\.vsix not found/);
    fs.writeFileSync(path.join(dir, 'virtual-whip-1.2.3.vsix'), 'x');
    assert.throws(() => releaseFiles(dir, 'virtual-whip', '1.2.3'), /install-virtual-whip\.bat not found/);
    fs.writeFileSync(path.join(dir, 'install-virtual-whip.bat'), 'x');
    assert.deepEqual(
        releaseFiles(dir, 'virtual-whip', '1.2.3').map((f) => path.basename(f)),
        ['virtual-whip-1.2.3.vsix', 'install-virtual-whip.bat']
    );
});
