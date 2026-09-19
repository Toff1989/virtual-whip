# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-19

Message delivery you can diagnose and correct, fewer accidental cracks, and a whip that follows
your settings without restarting.

### Added
- **Command *Use This Terminal for Claude Code***: marks (or unmarks) the active terminal as a
  Claude Code terminal. Automatic detection relies on the shell integration of VS Code, which
  `cmd.exe` and some terminals do not have.
- **Command *Diagnose Message Delivery***: writes to the log what the extension sees (terminals
  and their shell integration, the Copilot chat command, the Claude Code extension, and where a
  crack would go). The log only comes forward when asked.
- **`virtualWhip.gestureModifier`** (`ctrl`, `shift`, `alt`): a key to hold while flicking, against
  accidental cracks.
- **`virtualWhip.preserveTerminalDraft`** (experimental, off by default): sets aside what the user
  was typing in Claude Code's prompt while the message goes through, then puts it back.
- Explanations shown once when a crack goes to Copilot because no Claude Code terminal was
  detected: a terminal without shell integration, or the Claude Code chat panel (which cannot be
  driven; `claudeCode.useTerminal` is the way around it).
- **Live update**: appearance, sensitivity, cooldown, messages and gesture key are applied to the
  running overlay through a new `CONFIG:` command, without restarting it.
- The built-in messages are translated to the display language of VS Code.
- `WhipOverlay.exe --selftest`, and file properties on the executable (product, version, license,
  address of the source code).
- `SHA256SUMS.txt` and a GitHub build attestation with each release, starting with this one, so
  that a download of the unsigned overlay can be checked.
- Tests: from 42 to over 100. The message router, the overlay protocol, the life of the overlay
  process (restarts, live update) and the real overlay process are now covered.

### Changed
- If sending to the Copilot chat fails (its internal command is not a public API), the error is
  shown once instead of only being written to the log; the log names the VS Code version.
- A flick made while a mouse button is held (selecting text, dragging a window) no longer cracks
  the whip.
- Settings changes made within a quarter of a second of each other are applied together.

### Fixed
- After a restart of the overlay (any setting that needs one), the status bar kept saying
  "Whip off" while the whip was showing.
- A burst of settings changes, such as *Reset Appearance*, could restart the overlay with the
  values of the first change only: the configuration was read before the burst was over. It is now
  read when the overlay starts again. (Found by reading the code; a test now covers it.)
- Unmarking a terminal as Claude Code left it as the "last used" target.
- A malformed anchor position from the overlay (such as `WHIP_ANCHOR:,`) is no longer read as
  the top-left corner.

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

[0.2.0]: https://github.com/Toff1989/virtual-whip/releases/tag/v0.2.0
[0.1.0]: https://github.com/Toff1989/virtual-whip/releases/tag/v0.1.0
