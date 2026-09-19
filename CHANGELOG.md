# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-19

First release.

### Added
- **A virtual whip on your screen**: a rope simulated by a small physics engine (gravity,
  inertia), drawn as a smooth curve, attached to an anchor point and following the cursor within
  an adjustable **maximum length** (`maxLength`).
- **Draggable anchor point**: hold the left button on it and move; the position is remembered
  (command *Reset Anchor Point Position* to put it back).
- **Crack on gesture**: a sharp flick of the mouse triggers a sound and a flash at the tip of the
  whip (`sensitivity`, `cooldownMs`).
- **Direct message delivery without touching the focus**:
  - Claude Code terminal: `Escape` interrupts the ongoing turn, then the message is sent;
  - Copilot chat: `workbench.action.chat.submit` with "stop and send", `preserveFocus` and
    `preserveInput`.
- Delivery settings: `target`, `interruptBeforeSend`, `interruptDelayMs`, `reasoningEffort`
  (`/effort` in the Claude Code terminal), and user-editable `messages`.
- **Customization**: 6 built-in styles (Leather, Neon, Fire, Ice, Gold, Shadow) and about fifteen
  settings: rope colors (base to tip gradient), opacity, thicknesses, glow, gravity, inertia,
  anchor point color and size, crack effect (enabled, color, size, duration, number of rays).
  Commands *Choose a Style* and *Reset Appearance*.
- **Built-in crack sound** (synthesized, copyright-free), `sound.volume`, and a custom
  `audioFilePath` (`.wav` or `.mp3`, `${workspaceFolder}` accepted).
- `showOnlyWhenFocused` and `autoStart` settings.
- **Native Windows overlay** (C#, built with the system's `csc.exe`): transparent windows, always
  on top, that never take the focus and let clicks through.
- English interface with a **French translation**.
- Standalone single-file installer (`install-virtual-whip.bat`), `VERSION.txt` as the single
  source of the version number, `WhipOverlay.exe --snapshot` to render previews without opening
  a window, automated tests and GitHub Actions continuous integration.

### Security
- `messages`, `target` and `reasoningEffort` are limited to **user settings**: a project folder
  cannot redefine them (these texts are typed into the terminal).

[0.1.0]: https://github.com/Toff1989/virtual-whip/releases/tag/v0.1.0
