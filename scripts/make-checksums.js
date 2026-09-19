// Writes SHA256SUMS.txt for the files published in a release: the .vsix and the standalone
// installer. The overlay is an unsigned executable, so this is how a download can be checked
// against what the build produced. The format is the one of `sha256sum -c`.
//
//   npm run package     builds everything, then calls this script
//   npm run checksums   regenerates only the sums (the files must already exist)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** SHA-256 of a file, as lowercase hexadecimal. */
function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** One line per file: `<hash>  <name>` (two spaces, as `sha256sum` writes them). */
function checksumLines(files) {
    return files.map((file) => `${sha256(file)}  ${path.basename(file)}`);
}

/** The files of a release, in a stable order. Throws when one of them is missing. */
function releaseFiles(root, name, version) {
    const files = [path.join(root, `${name}-${version}.vsix`), path.join(root, 'install-virtual-whip.bat')];
    for (const file of files) {
        if (!fs.existsSync(file)) {
            throw new Error(`${path.basename(file)} not found: run "npm run package" first.`);
        }
    }
    return files;
}

module.exports = { sha256, checksumLines, releaseFiles };

if (require.main === module) {
    const { readVersion } = require('./version');
    const root = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    try {
        const lines = checksumLines(releaseFiles(root, pkg.name, readVersion()));
        fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
        console.log(`[make-checksums] OK -> SHA256SUMS.txt\n${lines.join('\n')}`);
    } catch (error) {
        console.error(`[make-checksums] ${error.message}`);
        process.exit(1);
    }
}
