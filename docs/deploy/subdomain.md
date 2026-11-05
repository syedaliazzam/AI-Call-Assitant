# Custom domain: call.paramountintelligence.co

The app's address for people is `https://call.paramountintelligence.co`. The old address, `https://kite-call-assistant.vercel.app`, must keep working with no redirect: installed desktop apps (1.1.0 and 1.2.0) load it and block every other origin. The reasons are in [ADR-0046](../decisions/ADR-0046-custom-domain-with-two-addresses.md).

## Setup

**1. Domain.** In Vercel: Project → Settings → Domains → add the domain for Production. Add the CNAME record Vercel shows in the company DNS. Vercel issues the certificate. Do not add a redirect on the old address.

**2. Settings.** Both are Production only. They are public addresses, so store them as Config, which also lets you check them. Without `--no-sensitive` the CLI stores them as Secret and they cannot be read back.

```sh
vercel env add BETTER_AUTH_URL production --no-sensitive --force
vercel env add KITE_TRUSTED_ORIGINS production --no-sensitive
```

- `BETTER_AUTH_URL`: the new address.
- `KITE_TRUSTED_ORIGINS`: both addresses, comma-separated. **Without the old address here, sign-in on it is refused**, because Better Auth trusts only the addresses it is told about.

**3. Deploy.** A setting only reaches new deployments, so nothing changes until this step.

```sh
vercel deploy --prod
```

## What needs no setting

- **Cookies:** the sign-in cookie has no domain set, so each address keeps its own. A person signs in once per address.
- **CSP:** the app sends no Content-Security-Policy header, so there is no list of addresses to update. If one is added later, it must allow both addresses.
- **Links inside the app** are relative, so each address stays on itself. The download link goes to the GitHub releases page and does not depend on the domain.

## Check it

```sh
vercel api "/v6/domains/call.paramountintelligence.co/config?teamId=<team id>"   # misconfigured: false
pnpm --filter web test:e2e-prod domain.spec.ts   # free: both addresses
pnpm --filter web test:e2e-prod chrome.spec.ts   # a call on the new address (paid: about 3 requests)
pnpm --filter web test:e2e-prod routes.spec.ts -g "Ask AI"                       # paid: 1 request
```

The team id is `orgId` in `.vercel/project.json`.

To check a desktop app on the old address, use a built program on a temporary profile (paid: about 4 requests). The suite turns off its update check:

```sh
KITE_E2E_URL=https://kite-call-assistant.vercel.app KITE_INSTALLED_EXE="<path to the program>" pnpm --filter web test:e2e-prod desktop.spec.ts
```

To check the admin page, turn the admin test account on for that one run and off straight after:

```sh
pnpm --filter web e2e-admin --enable
KITE_E2E_ADMIN_ON=1 pnpm --filter web test:e2e-prod domain.spec.ts -g "admin page"
pnpm --filter web e2e-admin --disable
```

## Roll back

**1. Put the previous deployment back.** It keeps the settings it was built with, so this alone restores the old sign-in behaviour. The old address works straight away, and sign-in on the new address is refused.

```sh
npx vercel rollback <URL of the previous production deployment>
```

`vercel ls --prod` lists them. After a rollback, new deploys do not go live by themselves until you run `vercel promote` on one.

**2. Put the settings back,** so that the next deploy does not bring the change back:

```sh
vercel env add BETTER_AUTH_URL production --no-sensitive --force   # the old address
vercel env rm KITE_TRUSTED_ORIGINS production
```

Leave the domain in place unless you are dropping it. Sessions made on the new address while it was live stay in those browsers; they can be moved with **Export my data** and **Import data**.

## Before a desktop release changes its address

Sessions, documents and settings are stored per address. A desktop release that opens a new address starts on an empty app and asks people to sign in again, although their data is still on disk under the old address. **Do not release such a version until this is solved.** See ADR-0046.
