/**
 * Built-in messages, used while the user has not written their own list. English is the source
 * language; they are translated at runtime through `vscode.l10n` (see l10n/bundle.l10n.*.json).
 * A test checks that this list stays identical to the default of `virtualWhip.messages` in
 * package.json.
 */
export const DEFAULT_MESSAGES: readonly string[] = [
    'Come on, faster!',
    'Speed up, but stay precise.',
    'Hurry up (without rushing)!',
    'Go faster, but keep the quality.',
    'Faster than that!',
    "We don't have all day, speed up."
];

/**
 * The messages to send: the user's own list, or the built-in ones (translated) when it is
 * missing or holds nothing but blank entries.
 */
export function resolveMessages(
    configured: readonly unknown[] | undefined,
    translate: (text: string) => string = (text) => text
): string[] {
    const own = (configured ?? []).filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
    return own.length > 0 ? own : DEFAULT_MESSAGES.map(translate);
}
