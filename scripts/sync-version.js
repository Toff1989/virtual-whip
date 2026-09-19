// Copies the version from VERSION.txt into package.json and package-lock.json
// (vsce insists on reading package.json to name and package the .vsix).
//
//   node scripts/sync-version.js           synchronizes
//   node scripts/sync-version.js --check   fails if a file is out of date
//
// Runs automatically before "npm run compile" (the "precompile" hook): edit VERSION.txt,
// then compile or package as usual.
const fs = require('fs');
const path = require('path');
const { readVersion } = require('./version');

const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');

let version;
try {
    version = readVersion();
} catch (error) {
    console.error(`[sync-version] ${error.message}`);
    process.exit(1);
}

let outOfSync = false;

function sync(fileName, getVersions, setVersion) {
    const file = path.join(root, fileName);
    if (!fs.existsSync(file)) return;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const current = getVersions(json);
    if (current.every((v) => v === version)) {
        console.log(`[sync-version] ${fileName}: already at ${version}`);
        return;
    }
    outOfSync = true;
    if (checkOnly) {
        console.error(`[sync-version] ${fileName}: ${current.join(' / ')} != ${version} (VERSION.txt)`);
        return;
    }
    setVersion(json);
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    console.log(`[sync-version] ${fileName}: ${current.join(' / ')} -> ${version}`);
}

sync(
    'package.json',
    (pkg) => [pkg.version],
    (pkg) => { pkg.version = version; }
);
sync(
    'package-lock.json',
    (lock) => [lock.version, lock.packages && lock.packages[''] && lock.packages[''].version].filter((v) => v !== undefined),
    (lock) => {
        lock.version = version;
        if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    }
);

if (checkOnly && outOfSync) {
    console.error('[sync-version] run "npm run sync-version" (or "npm run compile") to synchronize.');
    process.exit(1);
}
