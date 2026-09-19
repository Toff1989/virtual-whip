// Reads the version from VERSION.txt, the single source of truth of the project.
const fs = require('fs');
const path = require('path');

const versionFile = path.join(__dirname, '..', 'VERSION.txt');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readVersion() {
    if (!fs.existsSync(versionFile)) {
        throw new Error('VERSION.txt not found at the project root.');
    }
    // A BOM (Notepad) and line endings are ignored.
    const version = fs.readFileSync(versionFile, 'utf8').replace(/^﻿/, '').trim();
    if (!SEMVER.test(version)) {
        throw new Error(`VERSION.txt must contain a version like 1.2.3 (found: "${version}").`);
    }
    return version;
}

module.exports = { readVersion, versionFile };
