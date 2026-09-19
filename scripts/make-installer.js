// Generates install-virtual-whip.bat: a standalone, single-file installer that embeds the
// .vsix as base64. It works on any Windows PC that has VS Code, with no Node, no npm and
// no compiler.
//
//   npm run package     compiles, packages the .vsix, then generates the installer
//   npm run installer   regenerates only the installer (the .vsix must already exist)
const fs = require('fs');
const path = require('path');
const { readVersion } = require('./version');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let version;
try {
    version = readVersion(); // VERSION.txt is the single source of truth
} catch (error) {
    console.error(`[make-installer] ${error.message}`);
    process.exit(1);
}
if (pkg.version !== version) {
    console.error(`[make-installer] package.json is at ${pkg.version} but VERSION.txt is at ${version}: run "npm run package".`);
    process.exit(1);
}
const vsixPath = path.join(root, `${pkg.name}-${version}.vsix`);
const templatePath = path.join(__dirname, 'installer-template.bat');
const outputPath = path.join(root, 'install-virtual-whip.bat');

if (!fs.existsSync(vsixPath)) {
    console.error(`[make-installer] ${path.basename(vsixPath)} not found: run "npm run package" first.`);
    process.exit(1);
}

const template = fs.readFileSync(templatePath, 'utf8');
if (/[^\x00-\x7F]/.test(template)) {
    // cmd.exe reads .bat files in the OEM code page: any non-ASCII character would be corrupted.
    console.error('[make-installer] the template contains non-ASCII characters (accents are not allowed in a .bat).');
    process.exit(1);
}
if (!template.includes('@@VERSION@@')) {
    console.error('[make-installer] @@VERSION@@ marker missing from the template.');
    process.exit(1);
}

const payload = fs
    .readFileSync(vsixPath)
    .toString('base64')
    .match(/.{1,76}/g)
    .map((line) => '::B64:' + line);

const lines = template
    .replace(/\r?\n/g, '\n')
    .replace('@@VERSION@@', version)
    .trimEnd()
    .split('\n')
    .concat(['', ...payload]);

// CRLF is mandatory: cmd.exe mishandles labels and goto in a .bat with bare LF endings.
fs.writeFileSync(outputPath, lines.join('\r\n') + '\r\n', 'ascii');
console.log(`[make-installer] OK -> ${path.basename(outputPath)} (${Math.round(fs.statSync(outputPath).size / 1024)} KB, ${pkg.name} ${version})`);
