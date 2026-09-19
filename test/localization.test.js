// Tests of the localization (npm test): English is the default language, French is a translation
// through the standard VS Code mechanisms (package.nls.*.json and l10n/bundle.l10n.*.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRESETS } = require('../out/appearance');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const en = JSON.parse(read('package.nls.json'));
const fr = JSON.parse(read('package.nls.fr.json'));
const bundleFr = JSON.parse(read('l10n/bundle.l10n.fr.json'));

// ---------- package.json <-> package.nls*.json ----------

function usedKeys(node, out = new Set()) {
    if (typeof node === 'string') {
        const match = /^%(.+)%$/.exec(node);
        if (match) out.add(match[1]);
    } else if (Array.isArray(node)) {
        node.forEach((item) => usedKeys(item, out));
    } else if (node && typeof node === 'object') {
        Object.values(node).forEach((item) => usedKeys(item, out));
    }
    return out;
}

const used = usedKeys(pkg);

test('every %key% used in package.json exists in the English and French files', () => {
    for (const key of used) {
        assert.ok(key in en, `package.nls.json is missing "${key}"`);
        assert.ok(key in fr, `package.nls.fr.json is missing "${key}"`);
    }
});

test('package.nls.json contains no unused key', () => {
    for (const key of Object.keys(en)) {
        assert.ok(used.has(key), `"${key}" is not used by package.json`);
    }
});

test('the French file has exactly the keys of the English file', () => {
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test('translated values are not empty and the French one differs from the English one', () => {
    for (const key of Object.keys(en)) {
        assert.ok(en[key].trim() && fr[key].trim(), `"${key}" has an empty value`);
    }
    // Names shared by both languages (the command category) are the only allowed identical values.
    const same = Object.keys(en).filter((key) => en[key] === fr[key]);
    assert.deepEqual(same, ['command.category']);
});

test('every user-facing string of package.json is localized', () => {
    const fields = new Set(['displayName', 'description', 'markdownDescription', 'enumDescriptions', 'patternErrorMessage', 'title', 'category']);
    const errors = [];
    (function walk(node, trail) {
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${trail}[${i}]`));
        } else if (node && typeof node === 'object') {
            for (const [name, value] of Object.entries(node)) {
                const here = `${trail}.${name}`;
                if (fields.has(name)) {
                    for (const text of [].concat(value)) {
                        if (typeof text === 'string' && !/^%.+%$/.test(text)) errors.push(`${here} = "${text}"`);
                    }
                } else {
                    walk(value, here);
                }
            }
        }
    })(pkg, 'package.json');
    assert.deepEqual(errors, [], 'these strings must be %key% references');
});

// ---------- vscode.l10n.t() calls <-> l10n/bundle.l10n.fr.json ----------

const sourceDir = path.join(root, 'src');
const sources = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(sourceDir, f), 'utf8'));
const literalCall = /l10n\.t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const literals = new Set();
for (const text of sources) {
    for (const match of text.matchAll(literalCall)) {
        literals.add(match[2].replace(/\\(['"`\\])/g, '$1'));
    }
}
// Preset labels and descriptions are passed to l10n.t() through a variable.
const presetTexts = new Set(Object.values(PRESETS).flatMap((p) => [p.label, p.description]));

test('every vscode.l10n.t() string has a French translation', () => {
    assert.ok(literals.size >= 10, 'expected to find the l10n.t() calls of the extension');
    for (const text of [...literals, ...presetTexts]) {
        assert.ok(text in bundleFr, `l10n/bundle.l10n.fr.json is missing: ${text}`);
    }
});

test('the French bundle contains no orphan key', () => {
    const known = new Set([...literals, ...presetTexts]);
    for (const key of Object.keys(bundleFr)) {
        assert.ok(known.has(key), `unused translation: ${key}`);
    }
});

test('translations keep the same {n} placeholders', () => {
    const placeholders = (text) => (text.match(/\{\d+\}/g) || []).sort().join(',');
    for (const [source, translation] of Object.entries(bundleFr)) {
        assert.equal(placeholders(translation), placeholders(source), `placeholders differ for: ${source}`);
    }
});

test('package.json points to the l10n folder', () => {
    assert.equal(pkg.l10n, './l10n');
});

// ---------- English is the source language ----------

// Built from numeric code points so that this file (pure ASCII) does not match itself.
const FRENCH_CODE_POINTS = [
    0xe0, 0xe2, 0xe4, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xee, 0xef, 0xf4, 0xf6, 0xf9, 0xfb, 0xfc, 0xff, 0x153,
    0xc0, 0xc8, 0xc9, 0xca, 0xab, 0xbb
];
const FRENCH_CHARACTERS = new RegExp('[' + FRENCH_CODE_POINTS.map((c) => String.fromCharCode(c)).join('') + ']');
const FRENCH_FILES = new Set(['README.fr.md', 'package.nls.fr.json', path.join('l10n', 'bundle.l10n.fr.json')]);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'out', '.git', 'bin', 'docs', 'assets']);
const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.cs', '.json', '.md', '.yml', '.yaml', '.bat', '.txt']);
const TEXT_NAMES = new Set(['.gitignore', '.gitattributes', '.editorconfig', '.vscodeignore', 'LICENSE']);

function textFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) textFiles(full, out);
        } else if (TEXT_EXTENSIONS.has(path.extname(entry.name)) || TEXT_NAMES.has(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

test('no French text outside the French translation files', () => {
    const offenders = [];
    for (const file of textFiles(root)) {
        const relative = path.relative(root, file);
        if (FRENCH_FILES.has(relative) || relative === 'package-lock.json') continue;
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
            // The link to the French README is the only place where a French word is expected.
            if (FRENCH_CHARACTERS.test(line) && !line.includes('README.fr.md')) {
                offenders.push(`${relative}:${index + 1}: ${line.trim().slice(0, 80)}`);
            }
        });
    }
    assert.deepEqual(offenders, [], 'French text found in files that must be English');
});

test('the French translation files exist', () => {
    for (const file of FRENCH_FILES) {
        assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    }
});
