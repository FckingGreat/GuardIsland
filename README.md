# Guard Island

<p align="center">
  <img src="assets/logo.png" width="96" alt="Guard Island" />
</p>

Personal Windows security overlay. Dynamic Island at the top of the screen, face guard, USB reaction, process gate, file anomalies, Tailscale. No disk wipe. No hidden remote shell.

---

## Overview

Guard Island is an Electron app that sits on your own PC. You log in with a username and password, then arm the guards you actually want. By default everything is off or in test mode. The island is a small pill at the top of the primary display; click to expand, hide it completely from the tray.

---

## Features

| Block | Description |
|--------|-------------|
| **Island** | Compact pill flush to the top of the screen. Expand, collapse, or hide fully (restore from tray). **Quit** needs the same password as new programs; if it is not set, exit is blocked. While **Armed**, a normal user cannot End task the process. If it is killed, the app can restart; it does **not** lock Windows on a false alarm. |
| **Login** | App opens only after username + password. Change login or any secret in Settings only with the settings password or Windows Hello. |
| **Process gate** | **Relaxed** (default) — prompt only on suspicious launches (Downloads, USB, lone Desktop exe). Windows, WSL, Node, and installed programs are allowed. **Strict** — prompt almost everything except Windows / WSL / Node. Same exe name = one password prompt, not a stack. **Allowlist** from the prompt remembers an app and everything it launches; remove entries in Settings → Programs. |
| **USB** | React to a newly attached device (notify / lock / shutdown). Devices already plugged in at start are ignored. |
| **Face** | Optional camera watch. Owner face is stored only on this PC. |
| **Hotkey** | Global key (Insert by default) for lock, shutdown, or notify. |
| **Files** | Burst of new files in Desktop / Documents / Downloads / Telegram ChatExport. |
| **Remote** | Tailscale on *your* account. No custom C2. |
| **UI** | Dark or light theme (button in the title bar). Orange accent stays. Light mode uses black text on white. |

---

## Requirements

- **Windows** 10/11 x64
- Optional: webcam for face guard
- Optional: [Tailscale](https://tailscale.com/download/windows) for mesh access
- Optional: Windows Hello to confirm password changes

---

## Install

Download the latest [release](https://github.com/FckingGreat/GuardIsland/releases):

- **Guard.Island.Setup.*.exe** — installer. Puts the app in Start Menu / Apps, desktop shortcut, uninstall from Windows Settings.
- **Guard.Island.*.exe** — portable, no install.

Config lives in `%AppData%\Roaming\guardisland\`.

---

## Run & Build

```bash
# Install
npm install

# Run (dev)
npm start

# Installer + portable
npm run dist
```

Outputs:

- `dist/Guard.Island.Setup.1.0.4.exe`
- `dist/Guard.Island.1.0.4.exe`

---

## Safety

- No disk wipe. Panic password only locks the Windows session.
- Guards do nothing until **Armed** is on. **Test mode** logs/toasts instead of lock/shutdown.
- `C:\Windows\**` (including `wsl.exe`), Node, and WSL helpers are never gated.

---

## License

UNLICENSED — personal use.

---

## Contact

Telegram: [@fcking_great_bot](https://t.me/fcking_great_bot)
