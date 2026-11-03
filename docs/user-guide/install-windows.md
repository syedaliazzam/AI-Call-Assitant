# Install Kite on Windows

Kite is an internal Paramount Intelligence tool. You need an account from a Kite administrator to sign in.

## Install

1. Download the newest `Kite-Setup-<version>.exe` from [Kite releases](https://github.com/Zainpak123/kite-releases/releases/latest).
2. Open the file. Kite installs for your Windows user only, so it does not ask for an administrator password.
3. **If Windows shows "Windows protected your PC":** click **More info**, check that the app is `Kite-Setup-<version>.exe`, then click **Run anyway**. Windows shows this because the installer is not code-signed yet. It is the file from the link above.
4. Kite opens. Sign in with the email and password your administrator gave you; the first time, you choose a new password.

Kite is then in the Start menu as **Kite**. To learn how to use it, see [Using Kite](using-kite.md).

### Check the download (optional)

Each release lists the files' SHA-256 checksums in `SHA256SUMS.txt`. To check the installer, open PowerShell in your Downloads folder and run:

```powershell
Get-FileHash .\Kite-Setup-1.0.0.exe -Algorithm SHA256
```

The hash must match the `Kite-Setup-1.0.0.exe` line in `SHA256SUMS.txt`.

## If Windows blocks Kite (Smart App Control)

Some Windows 11 PCs have **Smart App Control** turned on. It blocks apps that are not signed with a certificate Microsoft knows about, and it has no "Run anyway" button. You might see "Part of this app has been blocked", or the installer or Kite may simply not start. Kite is not signed yet, so Smart App Control can block it.

**What Smart App Control does:** it stops unknown and unsigned programs from running, as an extra layer against new malware. Turning it off does **not** turn off Microsoft Defender Antivirus: virus and threat protection, the firewall and SmartScreen all stay on.

Choose one:
1. **Turn Smart App Control off:**
   - Open **Settings → Privacy & security → Windows Security → App & browser control → Smart App Control settings**, choose **Off**, then install Kite again.
   - With recent Windows updates you can turn it back on later in the same place, without resetting Windows.
   - There are exceptions, where turning it back on means resetting or reinstalling Windows ([Microsoft: What is Smart App Control?](https://support.microsoft.com/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003)):
     - the PC runs Windows in **S mode**;
     - **optional diagnostic data** is off;
     - the PC is **managed by your organisation (IT)** or has **developer mode** set up.
   - On a company laptop, ask your IT lead first.
2. **Ask your IT lead.** They may prefer to decide for company laptops.
3. **Use Kite in the browser instead.** Open Kite in Chrome or Edge and sign in with the same account. Everything works there except the desktop-only features: global shortcuts while another app is in front, the floating compact window hidden from screen share, and the system-audio connection without sharing a tab.

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
