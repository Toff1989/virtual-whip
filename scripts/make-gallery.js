// Generates the repository images with the overlay's off-screen mode (no window is opened):
//   docs/presets/<style>.png : gallery of the built-in styles (README)
//   assets/icon.png          : extension icon
//
//   npm run compile && node scripts/make-gallery.js
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { PRESET_NAMES, resolveAppearance } = require('../out/appearance');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'overlay', 'bin', 'WhipOverlay.exe');

if (process.platform !== 'win32' || !fs.existsSync(exe)) {
    console.error('[make-gallery] WhipOverlay.exe not found (Windows only): run "npm run compile".');
    process.exit(1);
}

function snapshot(output, size, config, background = '#1E1E1E') {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const result = cp.spawnSync(exe, ['--snapshot', output, '--size', size, '--bg', background], {
        env: { ...process.env, WHIP_CONFIG: JSON.stringify(config) },
        windowsHide: true
    });
    if (result.status !== 0 || !fs.existsSync(output)) {
        const errorFile = output + '.err';
        console.error(fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf8') : `failed (code ${result.status})`);
        process.exit(1);
    }
    console.log(`[make-gallery] ${path.relative(root, output)}`);
}

for (const name of PRESET_NAMES) {
    snapshot(path.join(root, 'docs', 'presets', `${name}.png`), '480x270', {
        maxLength: 450,
        appearance: resolveAppearance(name)
    });
}

snapshot(
    path.join(root, 'assets', 'icon.png'),
    '256x256',
    {
        maxLength: 300,
        appearance: resolveAppearance('leather', {
            whip: { thickness: 11, tipThickness: 3, opacity: 1, glow: 0.35 },
            anchor: { size: 11 },
            effect: { size: 0.8, rays: 10 }
        })
    }
);
