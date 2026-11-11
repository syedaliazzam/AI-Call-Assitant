# Google Drive saving and the "saved" email

Paramount AI can save each call's recording, transcript and notes to a Google Drive folder the person picks, and email the team when a session is saved. How it works and why: [ADR-0072](../decisions/ADR-0072-google-drive-saving.md). This page is the setup: the Google project, Vercel's values, and Resend.

Everything below is configuration. **No code changes** are needed to move from the test Google project to the team's.

## The values

All four Google values and the two Resend values are set in Vercel, Production (and Preview / Development if those should work too). Add each with `vercel env add NAME production`. Never put a value in the repository, a log or chat.

| Name | What it is | Secret? |
|---|---|---|
| `GOOGLE_CLIENT_ID` | The OAuth client's id (type **Web application**). | Not secret, but keep it in Vercel |
| `GOOGLE_CLIENT_SECRET` | The OAuth client's secret. | **Secret** |
| `GOOGLE_PICKER_API_KEY` | An API key restricted to the Picker API and Kite's addresses. Given to signed-in people only. | Restricted key |
| `NEXT_PUBLIC_GOOGLE_APP_ID` | The Google Cloud **project number** (not the project id). Picker uses it so a picked folder is shared with Kite. | No |
| `RESEND_API_KEY` | Resend API key (Sending access). | **Secret** |
| `NOTIFY_FROM_EMAIL` | The sender, on a domain verified in Resend, e.g. `Paramount AI <notify@paramountintelligence.co>`. | No |

A setting reaches only new deployments: run `vercel deploy --prod` after changing any of them.

## Switching from the test project to the team's project

Today's project is the developer's own test project (External, testing mode). To move to the team's:

**1. Create or open the team's Google Cloud project** (console.cloud.google.com), signed in with the team's Google Workspace admin or a project owner.

**2. Enable two APIs** (APIs & Services → Library): **Google Drive API** and **Google Picker API**.

**3. OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access):
- App name "Paramount AI", support email, the logo if wanted, and the app domain `paramountintelligence.co` (authorised domain).
- **Data access → scopes:** add only `https://www.googleapis.com/auth/drive.file`. Do not add `drive`, `drive.readonly`, Calendar or Gmail scopes. `drive.file` is a non-sensitive scope, so no Google verification review is needed for it.
- **Audience:**
  - *Internal* (only if the team's project belongs to the company's Google Workspace and everyone uses a company Google account): no test users, no 7-day limit.
  - *External, Testing*: only listed **test users** can connect, and their connections **expire after 7 days** (they then see "Reconnect Google Drive"). Fine for trying it out.
  - *External, In production* (Publish app): anyone with a Google account can connect, connections do not expire after 7 days. With only `drive.file`, publishing needs no verification.

**4. OAuth client** (Clients → Create client → **Web application**):
- **Authorised JavaScript origins:**
  - `https://call.paramountintelligence.co`
  - `https://kite-call-assistant.vercel.app`
- **Authorised redirect URIs** (exactly these):
  - `https://call.paramountintelligence.co/api/google/callback`
  - `https://kite-call-assistant.vercel.app/api/google/callback`
- For local development add `http://localhost:3000` and `http://localhost:3000/api/google/callback` too (optional).
- Copy the client id and secret.

**5. Picker API key** (APIs & Services → Credentials → Create credentials → API key), then *Edit*:
- **Application restrictions → Websites:** `https://call.paramountintelligence.co/*` and `https://kite-call-assistant.vercel.app/*` (and `http://localhost:3000/*` for development).
- **API restrictions → Restrict key:** **Google Picker API** only.

**6. Project number:** Dashboard (or IAM & Admin → Settings) → *Project number* (digits only).

**7. Replace the four values in Vercel** (`vercel env rm NAME production`, then `vercel env add NAME production`), then `vercel deploy --prod`.

**8. Everyone reconnects.** A refresh token belongs to the OAuth client that issued it. After the switch each person's next upload fails with `invalid_client` and their Settings shows **Reconnect Google Drive**; queued uploads are kept. Each person: Settings → Google Drive → **Reconnect Google Drive** → allow → in the Picker choose the **team folder** (Change folder if a folder from the old project is still shown). Uploads then continue by themselves.

### Shared Drives

- The Picker shows My Drive and a "Shared drives" view; a folder in a Shared Drive works like any other (every Drive call uses `supportsAllDrives`).
- The person needs at least **Contributor** on the Shared Drive (or Editor on the folder) to save there.
- Files saved into a Shared Drive belong to the Shared Drive, not the person, so they stay when someone leaves.
- People who should open the emailed link need access to the folder (the email says so). Easiest: put the team folder in a Shared Drive the team is a member of.

### What `drive.file` means for people

Paramount AI can see and change only the folder each person picks and the files Paramount AI makes there. It cannot list or read the rest of anyone's Drive. Disconnect (Settings) revokes the access at Google; people can also remove it at myaccount.google.com → Security → Third-party connections.

## Resend (the "saved" email)

Until both `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` are set, the email is off and Settings shows "Email not set up"; uploads work regardless.

**1. Account:** sign up at resend.com with the team's address.

**2. Domain:** Resend → Domains → Add domain. Use a subdomain for sending so the main domain's mail is untouched, for example **`send.paramountintelligence.co`** (or `paramountintelligence.co` itself). Pick the region nearest the team. Resend shows the DNS records to add.

**3. DNS on GoDaddy:** GoDaddy → My Products → `paramountintelligence.co` → DNS → Add new record, one for each record Resend shows. Typically:

| Type | Name (GoDaddy "Name" field) | Value | Notes |
|---|---|---|---|
| TXT | `resend._domainkey.send` | the long `p=…` DKIM key Resend shows | DKIM |
| MX | `send.send` (Resend shows the exact name) | `feedback-smtp.<region>.amazonses.com`, priority 10 | Bounce handling (SPF return path) |
| TXT | `send.send` (as above) | `v=spf1 include:amazonses.com ~all` | SPF for the return path |
| TXT (optional) | `_dmarc` | `v=DMARC1; p=none;` | DMARC, if the domain has none yet |

GoDaddy adds `.paramountintelligence.co` to each Name by itself, so type only the part Resend shows before the domain. Copy the values exactly from Resend (they differ per account and region). Do not change the existing MX records of the main domain (they carry the company's mail).

**4. Verify:** back in Resend press Verify; DNS can take minutes to a few hours.

**5. API key:** Resend → API Keys → Create, permission **Sending access**, domain: the one above.

**6. Vercel:** `vercel env add RESEND_API_KEY production` and `vercel env add NOTIFY_FROM_EMAIL production` (for example `Paramount AI <notify@send.paramountintelligence.co>`), then `vercel deploy --prod`.

**7. Check:** Settings → Google Drive now shows "Email me when a call is saved" (on) and "Also notify". After the next saved session, the email arrives once; Settings → Recent notifications shows "Email sent". A failed one shows Retry.

The email holds the session title, date, length, the saved files' names and the Drive folder link. Never transcript, notes, answer or document text.

## Database

The feature adds two tables (migration `apps/web/drizzle/0003_drive_connection.sql`, additive only). Apply once, after reading it:

```sh
pnpm --filter web db:migrate --prod
```

## Troubleshooting

| Settings / card says | Cause | Fix |
|---|---|---|
| Google Drive is not set up on this server yet | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing in this deployment | Add them, deploy |
| Google refused the connection / redirect_uri_mismatch on Google's page | The redirect URI for this address is not registered | Add it exactly (step 4) |
| Google Picker could not be loaded / Picker shows an error | Picker key missing, restricted to other sites, or Picker API not enabled; or `NEXT_PUBLIC_GOOGLE_APP_ID` is the project id instead of the number | Steps 2, 5, 6 |
| Reconnect Google Drive | Testing-mode 7-day expiry, access removed, or the project changed | Reconnect; publish the app (step 3) to stop weekly expiry |
| The Drive folder could not be opened | The folder was deleted or access to it removed | Settings → Change folder, then Retry |
| Email not set up | Resend values missing | Resend steps 5–6 |
| Email failed (Recent notifications) | Sender domain not verified, or Resend unreachable | Verify the domain; Retry |
