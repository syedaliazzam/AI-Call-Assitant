# Install Kite on Windows

Kite is an internal Paramount Intelligence tool. You need an account from a Kite administrator to sign in.

## Install

1. Download the newest `Kite-Setup-<version>.exe` from [Kite releases](https://github.com/Zainpak123/kite-releases/releases/latest).
2. Open the file. Kite installs for your Windows user only, so it does not ask for an administrator password.
3. **If Windows shows "Windows protected your PC":** click **More info**, check that the app is `Kite-Setup-<version>.exe`, then click **Run anyway**. Windows shows this because the installer is not code-signed yet. It is the file from the link above.
4. Kite opens. Sign in with the email and password your administrator gave you; the first time, you choose a new password.

Kite is then in the Start menu as **Kite**.

## Updates

- Kite checks for a new version when it starts and every 6 hours, and downloads it in the background.
- When a new version is ready, Kite asks: **Restart now** or **Later**.
  - **Later:** the new version is installed the next time you quit Kite.
  - Kite never asks during a live call; it waits until the call ends.

## Uninstall

1. Windows **Settings → Apps → Installed apps → Kite → Uninstall**.
2. Kite asks: "Keep your Kite data on this computer?"
   - **Yes:** your sessions, transcripts and settings stay, and come back if you install Kite again.
   - **No:** everything Kite stored on this computer is removed.
