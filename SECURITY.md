# Security policy

## Reporting a vulnerability

This project does not accept external contributions, but security reports are welcome. Use
GitHub's private reporting: the **Security → Report a vulnerability** tab of the repository.
Describe the problem, how to reproduce it and its impact.

## What the extension does (and does not do)

- It launches a local executable (`overlay/bin/WhipOverlay.exe`), **built from
  `overlay/WhipOverlay.cs`** by the C# compiler that ships with Windows. The source code is in the
  repository; the `install-virtual-whip.bat` installer embeds the `.vsix` built by the CI.
- The executable **opens no network connection** and only reads its configuration (environment
  variable) and the configured sound file.
- The extension **types text into a terminal** (Escape, `/effort`, then a message) or sends a
  message to the Copilot chat. This is the core of the feature, and therefore the sensitive
  surface.

## Measures in place

- `virtualWhip.messages`, `virtualWhip.target` and `virtualWhip.reasoningEffort` are declared with
  the **`application`** scope: only user settings can define them. A cloned repository therefore
  cannot make commands be typed into your terminal through its `.vscode/settings.json`. An
  automated test (`npm test`) protects this property.
- The extension does not activate in virtual workspaces.
- Colors and numbers of the appearance settings are validated and bounded before being passed to
  the overlay.

## Good to know

- With `virtualWhip.target` set to `claude`, if no Claude Code terminal is detected, the message
  is typed into the **active terminal**, whatever it is. Keep `auto` if you also use ordinary
  terminals.
- `virtualWhip.reasoningEffort` sends `/effort` to Claude Code, which saves the level as the
  model's default.
