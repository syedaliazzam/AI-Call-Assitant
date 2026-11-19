# The Mac signing certificate: make it once, keep it safe (stage 5)

**What this is.** Every Mac version of Paramount AI is signed with one company certificate, "Paramount Intelligence Internal Code Signing". Because the signature never changes:
- macOS keeps the Microphone and Screen Recording permissions after every update;
- the app's updater accepts only our own builds;
- the Terminal installer can check that an app really comes from us.

Background: ADR-0109.

**Who does what, and how long it takes:**

| Part | Who | Where | Time |
|---|---|---|---|
| A. Make the certificate and store it | The lead (or the developer, with the lead) | Any Mac | 15 minutes |
| B. Put the public part in the repository | The developer | The developer's laptop | 5 minutes |
| C. Set up the build Mac | The teammate who builds the Mac app | The build Mac | 15 minutes |

**The three rules**
1. **The certificate is made only once.** A new one means every Mac must reinstall Paramount AI by hand and allow its permissions again.
2. **The `.p12` file and its password are secret.** They live only in the company password manager, and for a few minutes on the Mac where they are used. Never put them in email, Slack, chat, a shared drive, the repository, or a screenshot.
3. **`certificate.pem` is public.** It can be sent anywhere; it goes into the repository.

---

## Part A: make the certificate and store it (the lead)

You need a Mac, the company password manager, and the file `make-signing-cert.sh` (in the repository at `apps/desktop/scripts/mac/`; the developer can send it to you).

1. **In the password manager**, create a new entry named **Paramount AI Mac signing certificate (.p12)**.
   - Let the password manager **generate a password** of at least 24 characters, and save the entry.
   - Share the entry with **the developer only**. The teammate who builds gets a different, local password in Part C.
2. **On the Mac**, open **Terminal** (Applications › Utilities › Terminal).
3. Type `bash ` (with a space after it), drag `make-signing-cert.sh` from Finder into the Terminal window, and press **Return**.
4. When it asks **Password for the .p12 file**, copy the password from the password-manager entry, paste it (nothing appears as you paste; that is normal), and press **Return**. Do the same when it asks again.
5. It prints **Done** and a folder name on your Desktop, `paramount-signing-<today's date>`, with two files:
   - `paramount-signing.p12`: **secret**
   - `certificate.pem`: public
6. **In the password manager**, open the entry from step 1:
   - **attach** `paramount-signing.p12` to it;
   - **paste the two fingerprints** Terminal printed (SHA-1 and SHA-256) into the entry's notes. They are not secret; they help check the certificate later.
7. Optional second copy: put the `.p12` on an encrypted USB stick kept in the office safe.
8. **Send `certificate.pem` to the developer** (email or Slack is fine: it is public).
9. **Delete the `.p12` from the Desktop folder:** drag it to the Bin, then empty the Bin. The master copy is now only in the password manager (and the optional USB stick).

**Something went wrong?** If the script stopped with "already exists", a certificate was made earlier: look in the password manager before making another. If the two passwords did not match, run it again.

---

## Part B: put the public part in the repository (the developer)

1. Save the received file as `apps/desktop/build/mac-signing/certificate.pem`.
2. Check its fingerprints match the ones in the password-manager entry:

   ```
   node apps/desktop/scripts/mac/cert-tools.mjs fingerprint apps/desktop/build/mac-signing/certificate.pem
   ```

3. Write its SHA-256 into the Terminal installer:

   ```
   node apps/desktop/scripts/mac/cert-tools.mjs pin apps/desktop/build/mac-signing/certificate.pem apps/web/public/install-mac.sh
   ```

4. Run the checks (`pnpm lint && pnpm typecheck && pnpm test`). The test "pins the committed company certificate" now runs instead of being skipped. Commit both files on the Mac release branch, and tell the teammate who builds (Part C).

---

## Part C: set up the build Mac (the teammate who builds)

Do this once, on the Mac that will build Paramount AI. First get the repository onto the Mac and pull the developer's commit with `certificate.pem` (Part B). Ask the developer if you are unsure.

1. **In your own password manager**, create an entry **Build Mac signing keychain** with a new generated password. This password is for a keychain on this Mac only.
2. Ask the developer to **share the password-manager entry** from Part A with you for a few minutes. Download `paramount-signing.p12` from it to your **Downloads** folder.
3. Open **Terminal**, go to the repository folder (for example `cd ~/AI-Call-Assitant`) and run:

   ```
   bash apps/desktop/scripts/mac/import-signing-cert.sh ~/Downloads/paramount-signing.p12
   ```

4. Answer what macOS asks, in this order:
   - **password for new keychain**: the password from step 1 (twice);
   - **password to unlock**: the same password;
   - **the .p12 file's password**: the one in the shared entry from Part A;
   - **the keychain password** again (to let only Apple's signing tool use the key);
   - **your Mac login password** (a window asks, to trust the certificate for code signing).
5. It ends with **PASS: the build Mac can sign Paramount AI**.
6. **Delete the downloaded `.p12`:** `rm ~/Downloads/paramount-signing.p12`. Tell the developer to **stop sharing** the entry with you.

**Something went wrong?**
- *"the keychain already exists"*: Part C was done before. To start again, run the command it prints (`security delete-keychain …`), then step 3 again.
- *"the .p12 holds a different certificate"*: the file is not the company's current certificate. Ask the developer.
- *"does not list the certificate as valid"*: open **Keychain Access**, choose the keychain **paramount-signing**, double-click the certificate, open **Trust** and set **Code Signing** to **Always Trust**. Close the window (enter your Mac password), then run step 3 again after deleting the keychain.

---

## Later

- **The certificate expires in about 2126.** Nothing to renew.
- **If the `.p12` or its password is ever exposed** (sent by mistake, a lost laptop that had it), tell the lead.
  - Someone holding it could sign an app that our installer and updater would accept.
  - The fix is a new certificate (Part A again), then Parts B and C, and a reinstall on every Mac.
- **If the certificate is lost** (no password-manager copy and no USB stick): same as above. Installed apps keep working, but cannot update by themselves to a build signed with the new certificate.
- **Moving to an Apple Developer ID** later is described in ADR-0109 §6 and `apps/desktop/electron-builder.mac-developer-id.yml`.
