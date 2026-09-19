# Contributing

Thanks for your interest in Virtual Whip! This guide explains how to set up the environment and
what is expected from a contribution.

## Getting started

Requirements: **Windows**, Node.js 20+, VS Code 1.93+. The C# compiler (`csc.exe`,
.NET Framework 4) is already provided by Windows.

```bash
git clone https://github.com/Toff1989/virtual-whip.git
cd virtual-whip
npm ci
npm run compile   # TypeScript extension + native C# overlay
npm test
```

Then press **F5** in VS Code: an "Extension Development Host" window opens with the extension.
After changing `src/`, run `npm run compile:ts` again (or keep `npm run watch` running); after
changing `overlay/WhipOverlay.cs`, run `npm run compile:overlay` and restart the whip.

## What to change where

| I want to... | Files |
|---|---|
| add or change a built-in style | `src/appearance.ts` (`PRESETS` table), then the enumeration and descriptions of `virtualWhip.appearance.preset` in `package.json` and the two `package.nls*.json` files, and the labels in `l10n/bundle.l10n.fr.json` |
| add an appearance setting | `src/appearance.ts`, `src/settings.ts` (`APPEARANCE_KEYS`), `package.json`, `package.nls*.json`, `overlay/WhipOverlay.cs` (`ReadAppearance`) |
| change where and how the message is sent | `src/messageRouter.ts` |
| change the drawing, the physics or the sound | `overlay/WhipOverlay.cs` |

The tests (`npm test`) check, among other things, that the defaults and limits in `package.json`
stay consistent with the code and that translations are complete: if you add a setting or a
message, they tell you what is missing.

After a change to the rendering, regenerate the previews: `node scripts/make-gallery.js`.

## Language and translations

The source language is **English**: code, comments, documentation, commit messages and every
string the user can see. French is provided as a translation through the standard VS Code
mechanisms:

- text contributed by `package.json` uses `%key%` placeholders defined in `package.nls.json`
  (English) and `package.nls.fr.json` (French);
- text shown by the extension at runtime goes through `vscode.l10n.t("English text")`, with the
  French version in `l10n/bundle.l10n.fr.json` (the English text is the key).

`npm test` fails if a key is missing, if a translation is orphaned, or if French text appears in a
file that must be English. To add another language, add the matching `package.nls.<lang>.json` and
`l10n/bundle.l10n.<lang>.json`.

## Repository rules

- **Version**: it only exists in `VERSION.txt`; do not edit `package.json` by hand.
  Add an entry to `CHANGELOG.md`.
- **`.bat` files**: ASCII only (no accents, `cmd.exe` reads the OEM code page) and CRLF line
  endings. `install-virtual-whip.bat` is generated (`npm run package`): do not edit it, edit
  `scripts/installer-template.bat`.
- **C#**: the overlay is built by the system's `csc.exe`, so **C# 5 only** (no string
  interpolation, no `?.`, etc.).
- **The focus must never change** when a message is sent: no `terminal.show()`, no
  `workbench.action.chat.open`, no `output.show()`.
- **Security**: settings whose text is typed into a terminal keep the `application` scope
  (see `SECURITY.md`).

## Submitting a change

1. Open an issue to discuss a significant change before coding it.
2. Create a branch from `main` and make clear commits.
3. Check that `npm run compile` and `npm test` pass.
4. Open a pull request and fill in the template: describe what changes and how you tested it (a
   screenshot or GIF helps a lot for visual changes).

## Reporting a bug

Use the "Bug" issue template and attach the *View → Output → Virtual Whip* log. For a security
vulnerability, follow [SECURITY.md](SECURITY.md) instead.
