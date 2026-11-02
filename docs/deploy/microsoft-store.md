# Publishing Kite through the Microsoft Store (private audience)

**Why:** an unsigned Kite installer can be blocked by Windows Smart App Control, which has no "Run anyway" (ADR-0028). The Microsoft Store signs every package with Microsoft's certificate, which Windows trusts, so no code-signing certificate has to be bought. This page covers distributing Kite **only to the team**, through a *private audience*.

**Status (2 Nov 2026):**
- The Store package (MSIX/AppX) builds: `pnpm --filter desktop dist:store`.
- The package installs and runs on a GitHub Actions Windows runner (manual CI job "desktop-store").
- Nothing has been submitted. The developer creates the account.

Facts checked on 2 Nov 2026; Microsoft changes these, so re-check the linked pages.

## 1. Create the company developer account (lead / developer, about 30 minutes plus verification)

1. Go to [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com) and choose **Company** (not Individual): the Store shows the account's publisher name ("Paramount Intelligence") on the listing.
2. **Sign in.** Use a Microsoft work account (Microsoft Entra ID) if the company has one; otherwise a Microsoft account that the company controls. Do not use a personal account that leaves with a person.
3. **Fee:** none. Company accounts became free in May 2026 ([Windows Developer blog](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/)); individual accounts became free in 2025. One older Microsoft page still shows fees ([register page](https://developer.microsoft.com/en-us/store/register)), so check the live sign-up.
4. **Verification:** Microsoft checks the company.
   - Have ready one business document, such as company formation documents, a business licence or registration certificate, an official registry record, or tax filings.
   - Have ready a contact who can answer a verification email or call.
   - It can take some days, so start early.

## 2. Reserve the name and copy the identity into the build

1. In [Partner Center](https://partner.microsoft.com/dashboard), go to **Apps and games → New product → MSIX or PWA app** and reserve the name **Kite** (or "Kite by Paramount Intelligence" if Kite is taken).
2. Open **Product management → Product identity**. Copy these into `apps/desktop/electron-builder.yml`, under `appx`, replacing the placeholders:
   - `Package/Identity/Name` → `identityName`;
   - `Package/Identity/Publisher` (`CN=…`) → `publisher`;
   - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`.
3. Build: `pnpm --filter desktop dist:store`. This gives `apps/desktop/release/Kite-<version>.appx`, unsigned, as the Store wants it: the Store signs it.

## 3. Private audience: only the team can see and install it

1. **Who:** each teammate needs a **personal Microsoft account** (outlook.com, hotmail.com, or any email registered as a Microsoft account). Work or school accounts may not work for private audiences.
2. In Partner Center, go to **Customers → Customer groups → New group** (for example "Kite team") and add the teammates' Microsoft account emails.
3. In the submission's **Pricing and availability**, set **Visibility → Private audience**, select the group, and set **Free**.
   - **Important:** choose Private audience on the **first** submission. A product once published to the public cannot be made private later ([visibility options](https://learn.microsoft.com/windows/uwp/publish/choose-visibility-options)).
   - Also under **Discoverability**, choose the option that stops the app appearing in Store search.
4. **Installing:** Partner Center gives a direct Store link. Teammates open it while signed in to the Store with the listed Microsoft account, then click **Get**. Some teams have reported members not seeing a private app at first; check that the person is signed in to the Store with the exact listed account.

## 4. The test account the reviewers need

Kite cannot be used without signing in, so certification fails unless the reviewers can sign in ([notes for certification](https://learn.microsoft.com/en-us/windows/uwp/publish/manage-submission-options)).

1. **Create a dedicated reviewer account.**
   - Run `pnpm --filter web create-e2e-user --email kite-store-review@<a mailbox you own>`, or create it at `/admin/users`.
   - Role: **user**, never admin.
   - Use invented data only: no real sessions.
2. Put the email and password in the submission's **Notes for certification**, never in this repository.
3. Also write in the notes:
   - "Kite is an internal call assistant for Paramount Intelligence employees. Sign in with the account above.
   - Create a session (Dashboard → New session), click Connect, allow the microphone, and share a browser tab or play audio for the other side.
   - Press Answer for an AI answer.
   - No purchase. Audio stays on the device."
4. Keep the account **enabled during certification** (up to three business days). Disable it after the app is published, and create a new one for each later submission.

## 5. Submission checklist

- [ ] The identity values from Partner Center are in `electron-builder.yml`; `pnpm --filter desktop dist:store` was built from `main`.
- [ ] The **version is higher** than the last submission. Store versions are `major.minor.build.0`; electron-builder converts `1.0.0` to `1.0.0.0`, and the 4th part must stay 0.
- [ ] The manual CI job **desktop-store** passed on the same commit: the package installs, starts and passes the smoke test.
- [ ] **Packages:** upload the `.appx`. Windows 10/11 desktop, x64.
- [ ] **Store listing:**
  - description ("Kite is Paramount Intelligence's internal call assistant…");
  - at least one desktop screenshot in a size Partner Center accepts (it lists them; 1920×1080 is safe), using invented data;
  - the Kite icon (the Store builds tiles from the package icons).
- [ ] **Privacy policy URL.** Required because Kite uses the microphone and accounts. Lead to decide where it lives (for example a page on the company site).
- [ ] **Age ratings questionnaire:** a business tool with no user-generated content shared publicly.
- [ ] **Properties:** category Business / Productivity; it needs a microphone; it needs internet.
- [ ] **Capabilities:** `runFullTrust` (restricted, with the reason "Desktop app built with Electron; needs full trust for audio capture, global hotkeys and window protection"), `microphone`, `internetClient`.
- [ ] **Pricing and availability:** Free, **Private audience** (section 3), markets as needed.
- [ ] **Notes for certification:** the test account and steps (section 4).
- [ ] Submit. **Certification takes up to three business days**; after it passes, the listing appears in about 15 minutes ([certification process](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)).

## 6. Updates

- The Store updates the app. Kite's own updater is off in Store builds (`process.windowsStore` in `apps/desktop/src/main.ts`), because Store policy forbids an app updating itself.
- Each update is a new submission with a higher version, and each goes through certification, so allow up to three business days.
- The NSIS installer and `kite-releases` remain for anyone not using the Store. They are both affected by Smart App Control until the lead decides on code signing.

## 7. Differences in the Store version

- **Install location:** Windows keeps the app in a protected folder, and Kite's local data (sessions, transcripts, settings) is stored inside the package. Uninstalling from Windows removes it, with no "keep my data" question; there is no Store equivalent.
- **Desktop and browser data:** the Store version's data is separate from the NSIS version's. A teammate who switches starts with an empty dashboard.
- **Everything else is the same app.** The CI check covers the packaged binaries; the Day 7 final test plan covers microphone, system audio, hotkeys, compact window and screen-share protection inside the installed Store package on a real laptop.
