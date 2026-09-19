// Extension <-> overlay protocol (see the README): pure functions, no dependency on VS Code, so
// that every line the overlay can print is tested without starting anything.

export type OverlayEvent =
    | { type: 'ready' }
    /** The anchor point was dropped somewhere else (fractions 0..1 of the screen). */
    | { type: 'anchor'; x: number; y: number }
    /** A crack: the message to send to the AI. */
    | { type: 'message'; text: string }
    /** A protocol line that could not be understood (the reason is meant for the log). */
    | { type: 'invalid'; reason: string }
    /** Anything else (`[overlay] ...` log lines). */
    | { type: 'log'; text: string };

const READY = 'OVERLAY_READY';
const ANCHOR_PREFIX = 'WHIP_ANCHOR:';
const MESSAGE_PREFIX = 'WHIP_MESSAGE:';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Number() turns '' into 0 and accepts '0x10', '1e3'...: the overlay only prints plain decimals.
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function parseOverlayLine(line: string): OverlayEvent {
    if (line === READY) {
        return { type: 'ready' };
    }
    if (line.startsWith(ANCHOR_PREFIX)) {
        const parts = line.slice(ANCHOR_PREFIX.length).split(',');
        if (parts.length !== 2 || !parts.every((part) => DECIMAL.test(part))) {
            return { type: 'invalid', reason: `invalid anchor position: ${line}` };
        }
        return { type: 'anchor', x: Number(parts[0]), y: Number(parts[1]) };
    }
    if (line.startsWith(MESSAGE_PREFIX)) {
        const encoded = line.slice(MESSAGE_PREFIX.length).trim();
        // Buffer.from() never throws on bad input: it silently produces garbage, so check first.
        if (!BASE64.test(encoded)) {
            return { type: 'invalid', reason: 'invalid message protocol: the payload is not base64' };
        }
        const text = Buffer.from(encoded, 'base64').toString('utf8');
        if (text.trim().length === 0) {
            return { type: 'invalid', reason: 'invalid message protocol: empty message' };
        }
        return { type: 'message', text };
    }
    return { type: 'log', text: line };
}

/** Command that hands a new configuration to the running overlay (settings that need no restart). */
export function encodeConfigCommand(config: unknown): string {
    return `CONFIG:${Buffer.from(JSON.stringify(config), 'utf8').toString('base64')}`;
}

/** Cuts a stream of text chunks into complete lines (LF or CRLF); the tail waits for its end. */
export class LineSplitter {
    private rest = '';

    push(chunk: string): string[] {
        const lines = (this.rest + chunk).split(/\r?\n/);
        this.rest = lines.pop() ?? '';
        return lines;
    }

    /** Forgets the unfinished line (the process that was writing it is gone). */
    reset(): void {
        this.rest = '';
    }
}
