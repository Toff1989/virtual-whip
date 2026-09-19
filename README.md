# 🪢 Virtual Whip

**English** | [Français](README.fr.md)

[![CI](https://github.com/Toff1989/virtual-whip/actions/workflows/ci.yml/badge.svg)](https://github.com/Toff1989/virtual-whip/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.93-007ACC.svg)

Is your AI thinking for too long? **Crack a virtual whip on your screen**: a sharp flick of the
mouse cracks the whip (sound + flash), interrupts the ongoing work of Claude Code or Copilot
Chat, and sends it a message telling it to hurry up. Without ever changing the focus of VS Code.

<p align="center">
  <img src="docs/presets/leather.png" alt="The leather whip, with its anchor point and the flash of the crack" width="640">
</p>

## Features

- **A real whip on screen**: a rope simulated by a small physics engine (gravity, inertia),
  attached to an anchor point and following your cursor, within a **maximum length**.
- **Draggable anchor point**: hold the left button on the circle, move, release. The position is
  remembered.
- **Crack on gesture**: a fast enough flick of the wrist triggers the sound and the flash.
- **Direct delivery to the AI, without touching the focus**:
  - **Claude Code terminal**: `Escape` interrupts the ongoing turn, then the message is sent;
  - **Copilot chat**: "stop and send", without stealing the focus or overwriting your draft.
- **Highly customizable**: 6 built-in styles and about fifteen settings (colors, thickness, glow,
  physics, effect, sound, behavior).
- **Light and dependency-free**: a small native Windows executable (~30 KB), no runtime to
  install. The whip is only shown while VS Code has the focus and lets every click through,
  except on the anchor point.

## Installation

Windows 10/11 and VS Code 1.93 or later.

**The easiest way**: download `install-virtual-whip.bat` from the
[Releases](https://github.com/Toff1989/virtual-whip/releases) page and double-click it. It is a
single-file installer with no prerequisite (no Node, no compiler): it installs the extension into
VS Code, VS Code Insiders and/or VSCodium, then cleans up after itself.

| Command | Effect |
|---|---|
| `install-virtual-whip.bat` | installs or updates the extension |
| `install-virtual-whip.bat uninstall` | uninstalls it |
| `install-virtual-whip.bat /s` | silent mode (no final pause) |

**Other ways**: download the `.vsix` from the Releases, then *Extensions → … → Install from
VSIX…*, or build from source (see [Development](#development)).

## Quick start

1. Restart VS Code, then click **"Whip off"** in the status bar (or press `Ctrl+Alt+F`) to show
   the whip.
2. Start Claude Code in a VS Code terminal (or open the Copilot chat and click once in its input
   box).
3. Make a **sharp flick of the mouse**: the whip cracks and the message is sent.

The built-in sound is used by default; you can pick another one (`virtualWhip.audioFilePath`).

## Customization

Open the settings (`Ctrl+,`) and search for **"virtualWhip"**: the settings are grouped into
sections. The **Virtual Whip: Choose a Style** command lists the built-in styles.

### Built-in styles (`virtualWhip.appearance.preset`)

| | | |
|:---:|:---:|:---:|
| <img src="docs/presets/leather.png" width="250"><br>**Leather** (default) | <img src="docs/presets/neon.png" width="250"><br>**Neon** | <img src="docs/presets/fire.png" width="250"><br>**Fire** |
| <img src="docs/presets/ice.png" width="250"><br>**Ice** | <img src="docs/presets/gold.png" width="250"><br>**Gold** | <img src="docs/presets/shadow.png" width="250"><br>**Shadow** |

Every appearance setting you change **takes precedence over the style**; the ones you have not
touched follow the style. *Virtual Whip: Reset Appearance* clears everything.

```jsonc
{
  "virtualWhip.appearance.preset": "neon",
  "virtualWhip.whip.thickness": 9,       // thicker rope
  "virtualWhip.maxLength": 600,          // longer whip
  "virtualWhip.effect.color": "#ff4d94", // pink flash
  "virtualWhip.sound.volume": 60
}
```

### All settings

**General**

| Setting | Default | Purpose |
|---|---|---|
| `virtualWhip.autoStart` | `false` | shows the whip when VS Code starts |
| `virtualWhip.showOnlyWhenFocused` | `true` | hides the whip when VS Code does not have the focus |
| `virtualWhip.sensitivity` | `3.5` | minimum speed of the gesture (px/ms); higher = less sensitive |
| `virtualWhip.cooldownMs` | `650` | minimum delay between two cracks |
| `virtualWhip.maxLength` | `450` | maximum length of the whip (px) |
| `virtualWhip.anchorPosition` | `bottom-right` | starting corner of the anchor point |

**Message delivery**

| Setting | Default | Purpose |
|---|---|---|
| `virtualWhip.messages` | 6 messages | texts sent at random *(user settings only)* |
| `virtualWhip.target` | `auto` | `auto`, `claude` or `copilot` *(user settings only)* |
| `virtualWhip.interruptBeforeSend` | `true` | interrupts the ongoing work before sending |
| `virtualWhip.interruptDelayMs` | `200` | delay between the interruption and the message (terminal) |
| `virtualWhip.reasoningEffort` | `unchanged` | `low` / `medium` / `high`: sends `/effort` to Claude Code |

**Whip appearance**

| Setting | Default | Purpose |
|---|---|---|
| `virtualWhip.appearance.preset` | `leather` | built-in style |
| `virtualWhip.whip.colorBase` / `colorTip` | `#785032` / `#D2A064` | gradient from base to tip |
| `virtualWhip.whip.opacity` | `0.9` | opacity (0.1 to 1) |
| `virtualWhip.whip.thickness` / `tipThickness` | `7` / `2` | thickness at the base and at the tip (px) |
| `virtualWhip.whip.glow` | `0` | glow intensity (0 to 1) |
| `virtualWhip.whip.gravity` | `0.35` | weight of the rope (0 = it floats) |
| `virtualWhip.whip.damping` | `0.985` | inertia (close to 1 = it swings for a long time) |

**Anchor point and crack effect**

| Setting | Default | Purpose |
|---|---|---|
| `virtualWhip.anchor.color` / `size` | `#3C2D1E` / `9` | color and radius of the anchor point |
| `virtualWhip.effect.enabled` | `true` | shows the flash at the tip of the whip |
| `virtualWhip.effect.color` | `#FFE6B4` | color of the flash |
| `virtualWhip.effect.size` | `1` | size of the flash (0.3 to 3) |
| `virtualWhip.effect.durationMs` | `380` | duration of the flash |
| `virtualWhip.effect.rays` | `8` | number of rays (0 = wave only) |

**Sound**

| Setting | Default | Purpose |
|---|---|---|
| `virtualWhip.audioFilePath` | empty | `.wav` or `.mp3`; empty = built-in sound; `${workspaceFolder}` accepted |
| `virtualWhip.sound.volume` | `100` | from 0 (muted) to 100 |

### Commands

| Command | Purpose |
|---|---|
| `Virtual Whip: Toggle Whip` (`Ctrl+Alt+F`) | turns the whip on or off |
| `Virtual Whip: Crack Now (test)` | triggers a crack without a gesture |
| `Virtual Whip: Choose a Style` | picks a built-in style |
| `Virtual Whip: Reset Appearance` | restores the default style and colors |
| `Virtual Whip: Reset Anchor Point Position` | puts the anchor point back in its corner |

## Where the message goes

| `virtualWhip.target` | Behavior |
|---|---|
| `auto` (default) | Claude Code terminal if one is detected, otherwise Copilot chat |
| `claude` | Claude Code terminal only (the active terminal if none is detected) |
| `copilot` | Copilot chat only |

- **Claude Code terminal**: detected when a `claude` command is started in it (or when the
  terminal name contains "claude"). The message is typed with `sendText`, without
  `terminal.show`, so the focus and the visible panel are left alone.
- **Copilot chat**: internal command `workbench.action.chat.submit` with `preserveFocus` and
  `preserveInput`; the chat must have been clicked at least once in the window.
- **Interruption** (`virtualWhip.interruptBeforeSend`): without it, the message would be queued
  until the end of the model's turn. Terminal: `Escape` before the message (never two `Escape` less
  than 1.5 s apart, which would trigger "rewind"). Copilot: "stop and send".
- **Reasoning level** (`virtualWhip.reasoningEffort`, off by default): Claude Code terminal only.
  ⚠️ Claude Code saves this level as the model's default; `/effort auto` restores it.

## Known limitations

- **Windows only** (native transparent window, sound through the Windows multimedia API).
- The **Claude Code extension's chat** is not supported (its API can only prefill the input, not
  send). Enable its `claudeCode.useTerminal` setting: it then goes through a terminal, which the
  whip handles.
- The reasoning level does not apply to the Copilot chat (no public API).
- Clicking the anchor point depends on Windows: if the drag does not start, a safety net detects
  the press on the circle, but the click may then also reach the window underneath.
- The extension is not published on the Marketplace (publisher `local`): install it from the
  Releases.

## Troubleshooting

| Symptom | Lead |
|---|---|
| Nothing is displayed | the VS Code window must have the focus (or disable `virtualWhip.showOnlyWhenFocused`); check *View → Output → Virtual Whip* |
| "overlay is not compiled" | run `npm run compile` (installation from source) |
| The whip cracks too easily | raise `virtualWhip.sensitivity` (try 6 to 8 on a large screen) |
| The message does not go through | check `virtualWhip.target`; for Copilot, click once in the chat input |
| No sound | `virtualWhip.sound.volume` above 0; an `.mp3` must be playable by Windows |

## Building from source

Requirements: Windows, Node.js 20+, VS Code. The C# compiler (`csc.exe`, .NET Framework 4) is
already part of Windows.

```bash
npm ci                 # dependencies
npm run compile        # extension (TypeScript) + native overlay (C#)
npm test               # tests (appearance, settings, localization, extension)
```

Then press **F5** in VS Code to launch an "Extension Development Host" window with the extension.

| Script | Purpose |
|---|---|
| `npm run compile` | builds everything (also copies `VERSION.txt` into `package.json`) |
| `npm run watch` | rebuilds the TypeScript continuously |
| `npm test` | unit tests (`node --test`) |
| `npm run package` | builds, produces the `.vsix` and the `install-virtual-whip.bat` installer |
| `node scripts/make-gallery.js` | regenerates `docs/presets/*.png` and `assets/icon.png` |
| `node scripts/make-default-sound.js` | regenerates the built-in sound `assets/crack.wav` |

**Version number**: it is only written in [`VERSION.txt`](VERSION.txt). `npm run compile` copies
it into `package.json` and `package-lock.json` (required by `vsce`).

**Languages**: English is the source language; French is a translation provided through
`package.nls.fr.json` and `l10n/bundle.l10n.fr.json`. `npm test` fails if a translation is missing
or if French text appears in a file that must be English.

**Repository rules**

- `.bat` files: ASCII only and CRLF line endings. `install-virtual-whip.bat` is generated: edit
  `scripts/installer-template.bat` instead.
- The overlay is built by the system's `csc.exe`, so **C# 5 only** (no string interpolation, no `?.`).
- The focus must never change when a message is sent: no `terminal.show()`, no
  `workbench.action.chat.open`, no `output.show()`.
- `virtualWhip.messages`, `target` and `reasoningEffort` keep the `application` scope (see
  [SECURITY.md](SECURITY.md)).

```
virtual-whip/
  src/
    extension.ts        activation, status bar, commands
    settings.ts         reads the settings, detects what the user changed
    appearance.ts       built-in styles and style + settings resolution (tested)
    messageRouter.ts    message delivery: Claude Code terminal / Copilot chat
    sidecarManager.ts   starts the overlay and talks to it
  overlay/WhipOverlay.cs    native overlay: transparent windows, physics, gesture, sound
  scripts/              overlay build, version, installer, images, sound
  test/                 unit tests
  assets/               icon and built-in sound
  l10n/                 runtime translations (French)
  docs/presets/         style previews (README)
```

The `WhipOverlay.exe --snapshot output.png` mode draws a scene into a PNG without opening any
window: it produces the previews and lets you check a style without showing anything on screen.

### Extension ↔ overlay protocol

- Configuration: `WHIP_CONFIG` environment variable (JSON).
- stdin, one command per line: `SHOW`, `HIDE`, `CRACK`, `STATUS`, `QUIT`.
- stdout: `OVERLAY_READY`, `WHIP_MESSAGE:<base64 utf-8>` on every crack,
  `WHIP_ANCHOR:<x>,<y>` when the anchor is moved (fractions 0..1 of the screen), and
  `[overlay] ...` log lines.
- If stdin closes (VS Code exits), the overlay stops by itself.

See [CHANGELOG.md](CHANGELOG.md) for the history and [SECURITY.md](SECURITY.md) to report a
vulnerability.

## Project status

Virtual Whip is a personal project, shared as is. **It does not accept external contributions**:
pull requests, issues and discussions are turned off. You are welcome to use it and, under the
terms of the MIT license, to fork it and adapt it for yourself.

## License

[MIT](LICENSE)
