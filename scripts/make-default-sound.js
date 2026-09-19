// Generates assets/crack.wav: a synthetic whip crack (no external sample, so no copyright to
// manage). The result is deterministic: running the script again produces the exact same file.
//
//   node scripts/make-default-sound.js
//
// Recipe: a rising whoosh of air, then the crack itself (a very short, bright transient plus
// a low body), then a short reverb.
const fs = require('fs');
const path = require('path');

const RATE = 44100;
const DURATION = 0.7;
const CRACK_AT = 0.075; // moment of the crack, in seconds
const samples = Math.floor(RATE * DURATION);

// Fixed-seed pseudo-random generator (LCG) for reproducible noise.
let seed = 0x2f6e2b1;
function noise() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
}

// State-variable filter (Chamberlin): returns the band-pass output.
function makeBandpass() {
    let low = 0;
    let band = 0;
    return (input, freq, q) => {
        const f = 2 * Math.sin((Math.PI * freq) / RATE);
        low += f * band;
        const high = input - low - band / q;
        band += f * high;
        return band;
    };
}

function makeLowpass(freq) {
    const a = 1 - Math.exp((-2 * Math.PI * freq) / RATE);
    let y = 0;
    return (x) => (y += a * (x - y));
}

const bandpass = makeBandpass();
const bodyLowpass = makeLowpass(1400);
const out = new Float64Array(samples);
let previous = 0;

for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const n = noise();
    let value = 0;

    // 1. whoosh of air rising in frequency and intensity up to the crack
    if (t < CRACK_AT + 0.02) {
        const rise = Math.min(1, t / CRACK_AT);
        const envelope = rise * rise * (t < CRACK_AT ? 1 : Math.exp(-(t - CRACK_AT) / 0.008));
        value += 0.55 * envelope * bandpass(n, 700 + 3800 * rise, 1.6);
    }

    // 2. the crack: bright transient (differentiated noise) + low body + initial "tick"
    if (t >= CRACK_AT) {
        const dt = t - CRACK_AT;
        const bright = (n - previous) * 0.5; // derivative: emphasizes the highs
        value += 1.0 * bright * Math.exp(-dt / 0.0045);
        value += 0.55 * bodyLowpass(n) * Math.exp(-dt / 0.03);
        value += 0.7 * Math.exp(-dt / 0.0009) * Math.sin(2 * Math.PI * 180 * dt);
        // 3. short echo / reverb, darker and quieter
        value += 0.10 * bandpass(n, 2400, 0.9) * Math.exp(-dt / 0.14);
    }
    previous = n;
    // Soft saturation: a transient this short would sound weak at the same peak level.
    out[i] = Math.tanh(value * 2.6);
}

// Normalization to -1 dBFS and a 40 ms fade-out.
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const gain = 0.89 / peak;
const fade = Math.floor(RATE * 0.04);
const pcm = Buffer.alloc(44 + samples * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + samples * 2, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20); // PCM
pcm.writeUInt16LE(1, 22); // mono
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
    const tail = samples - i < fade ? (samples - i) / fade : 1;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * gain * tail)) * 32767), 44 + i * 2);
}

const target = path.join(__dirname, '..', 'assets', 'crack.wav');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, pcm);
console.log(`[make-default-sound] OK -> ${path.relative(process.cwd(), target)} (${Math.round(pcm.length / 1024)} Ko, ${DURATION} s)`);
