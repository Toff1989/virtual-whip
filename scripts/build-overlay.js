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

const { readVersion } = require('./version');

const root = path.join(__dirname, '..');
const overlayDir = path.join(root, 'overlay');
const source = path.join(overlayDir, 'WhipOverlay.cs');
const outDir = path.join(overlayDir, 'bin');
const output = path.join(outDir, 'WhipOverlay.exe');
fs.mkdirSync(outDir, { recursive: true });

// File properties of the executable (Explorer > Properties > Details): an unsigned program that
// says what it is, who wrote it and where its source is looks less suspicious to SmartScreen and
// to antivirus heuristics, and to the person who wonders what this process is.
const version = readVersion();
const numeric = version.split('-')[0]; // "1.2.3-beta.1" -> "1.2.3"
const repository = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).repository.url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
const assemblyInfo = path.join(outDir, 'AssemblyInfo.g.cs');
fs.writeFileSync(assemblyInfo, [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("Virtual Whip overlay")]',
    `[assembly: AssemblyDescription("Transparent whip overlay of the Virtual Whip VS Code extension. Opens no network connection. Source: ${repository}")]`,
    '[assembly: AssemblyProduct("Virtual Whip")]',
    '[assembly: AssemblyCompany("Toff1989")]',
    '[assembly: AssemblyCopyright("Copyright (c) 2026 Toff1989. MIT License.")]',
    `[assembly: AssemblyVersion("${numeric}.0")]`,
    `[assembly: AssemblyFileVersion("${numeric}.0")]`,
    `[assembly: AssemblyInformationalVersion("${version}")]`,
    ''
].join('\r\n'));

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
    source,
    assemblyInfo
];

const result = cp.spawnSync(csc, args, { stdio: 'inherit' });
if (result.status !== 0) {
    console.error('[build-overlay] compilation failed.');
    process.exit(result.status || 1);
}
console.log(`[build-overlay] OK -> ${path.relative(process.cwd(), output)}`);
