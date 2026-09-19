// Compiles overlay/WhipOverlay.cs into overlay/bin/WhipOverlay.exe with the C# compiler
// that ships with Windows (.NET Framework 4, no SDK to install).
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') {
    console.log('[build-overlay] Windows only: overlay skipped.');
    process.exit(0);
}

const windir = process.env.WINDIR || 'C:\\Windows';
const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];
const csc = candidates.find((p) => fs.existsSync(p));
if (!csc) {
    console.error('[build-overlay] csc.exe not found (.NET Framework 4 required):\n  ' + candidates.join('\n  '));
    process.exit(1);
}

const overlayDir = path.join(__dirname, '..', 'overlay');
const source = path.join(overlayDir, 'WhipOverlay.cs');
const outDir = path.join(overlayDir, 'bin');
const output = path.join(outDir, 'WhipOverlay.exe');
fs.mkdirSync(outDir, { recursive: true });

const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    `/out:${output}`,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll',
    source
];

const result = cp.spawnSync(csc, args, { stdio: 'inherit' });
if (result.status !== 0) {
    console.error('[build-overlay] compilation failed.');
    process.exit(result.status || 1);
}
console.log(`[build-overlay] OK -> ${path.relative(process.cwd(), output)}`);
