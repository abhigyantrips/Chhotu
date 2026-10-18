# chhotu

A small, installable publisher for [abhi.now](https://abhi.now). Astro, Tailwind, Cloudflare Workers, Sour Gummy, and the main site's icons and dark palette.

The home screen is `choose.` with a single snippets icon. The snippets editor loads the real collections from `abhigyantrips/abhi.now`, accepts Markdown and a phone-local datetime, and publishes directly to `main`.

## What publishing does

- Writes `src/content/snippets/<folder>/<epoch-seconds>.md`.
- Creates `<folder>/_collection.json` in the same commit when adding a collection. New folder names match their permalinks; existing folders keep their names (for example, `mine` has the public permalink `thoughts`).
- Uses the exact commit headline `content(snippet): #<epoch-seconds>`.
- Uses GitHub's `createCommitOnBranch` API for GitHub-signed commits. The app reports the actual signature status returned by GitHub; your personal GPG key is never needed.
- Adds a `Chhotu-Publish-Id` trailer in the commit body to recover a successful publish if the phone loses the response. Retry the same draft without editing it to recover that commit.
- Checks for timestamp collisions across all snippet collections and uses an expected branch HEAD to prevent overwrites during concurrent updates. A conflict preserves your draft and refreshes collections for review.

A commit triggers the main site's existing deployment pipeline. The app shows links to the commit and eventual snippet; it does not claim that the site has finished deploying.

## Local development

Requires Node 22.22+ and pnpm 10.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev --background
```

Open <http://localhost:4321>. Without OAuth credentials, the editor and preview work, drafts save locally, and publishing stays disabled.

```sh
pnpm exec astro dev status
pnpm exec astro dev logs
pnpm exec astro dev stop
```

Stop the background dev server before running checks or a production build; Astro's generated state and Vite dependency caches are shared by those commands.

For local sign-in, create a **separate development OAuth app** with homepage `http://localhost:4321` and callback `http://localhost:4321/auth/callback`. Fill `.dev.vars` with that app's client ID and secret, a random session secret, and the local `APP_ORIGIN`. Restart the server after changing secrets.

Generate a session secret with:

```sh
openssl rand -hex 32
```

`.dev.vars` and all local credentials are ignored by Git. Do not paste credentials into source files.

## Production setup

The Worker and custom domain are configured in `wrangler.jsonc` as `chhotu` and `chhotu.abhi.now`. The Cloudflare account must manage the `abhi.now` zone.

1. [Create a GitHub OAuth app](https://github.com/settings/applications/new):
   - Application name: `chhotu`
   - Homepage URL: `https://chhotu.abhi.now`
   - Authorization callback URL: **`https://chhotu.abhi.now/auth/callback`**
   - Device flow: leave disabled.
2. Authenticate Cloudflare and deploy the Worker:

   ```sh
   pnpm exec wrangler login
   pnpm deploy
   ```

3. Set the three production secrets through Wrangler's hidden prompts:

   ```sh
   pnpm exec wrangler secret put GITHUB_CLIENT_ID
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
   pnpm exec wrangler secret put SESSION_SECRET
   ```

   Use the production OAuth app credentials and a fresh random session secret of at least 32 characters. `APP_ORIGIN=https://chhotu.abhi.now` is already configured as a non-secret Worker variable. Before secrets are set, sign-in shows a setup message and all publishing endpoints require authentication.

4. Open `https://chhotu.abhi.now`, choose snippets, sign in, and publish a snippet. Confirm its Verified badge and that the main site's deployment finishes.

No KV namespace, D1 database, PAT, GitHub App installation, or GPG key is required. The OAuth scope is `public_repo`, which GitHub grants for public repositories generally; Chhotu's server fixes the destination to this one repository. If the repository becomes private, the OAuth scope must be changed to `repo` and consent renewed. Branch rules must allow this account to commit directly to `main`.

### Install on your phone

- **Android / Chromium:** use **install chhotu** in the editor when offered, or the browser menu → Install app / Add to Home screen.
- **iPhone / iPad:** open the site in Safari → Share → Add to Home Screen → Open as Web App.

The installed app opens at `choose.`. On iOS, sign in from the installed app if Safari's session is not shared with it.

## Drafts and offline use

`@vite-pwa/astro` generates the web app manifest and Workbox service worker during `astro build`. Its configuration lives in `astro.config.mjs`; registration uses `virtual:pwa-register` and the manifest link uses `virtual:pwa-info`. Workbox precaches the public app shell, fonts, scripts, icons, and styles, including both clean routes and Astro's directory URLs. API/auth routes, OAuth redirects, and GitHub responses are never cached; runtime caching and navigation fallback are disabled. Prompt update mode leaves an update waiting until the old editor is closed, so it does not replace the code underneath an unfinished draft.

Draft text, datetime, new collection fields, and the most recently loaded collection list stay in this browser's local storage. After an initial online visit, you can reopen the editor and write offline; publishing requires a connection and valid sign-in. There is one draft per browser, no automatic background publishing, and no draft sync between devices. Signing out keeps the draft; **clear draft** removes it. Clearing browser site data also removes it. If storage is unavailable, the editor tells you to keep the page open.

Datetime values use the phone's current timezone and are converted to whole epoch seconds. Seconds are preserved. The main site's current schema requires a 10-digit timestamp; invalid dates and nonexistent daylight saving times are rejected. YAML frontmatter at the start of a snippet is rejected so it cannot override the site's derived collection/date fields.

The preview renders sanitized GitHub-flavored Markdown. The published site still uses its own Sätteri processor, so smart punctuation and some richer Markdown behavior may differ slightly.

## Authentication

GitHub OAuth uses random state and PKCE S256. The callback requires both username `abhigyantrips` and GitHub user ID `28886624`. Access and refresh tokens stay in an authenticated AES-GCM encrypted, HttpOnly, Secure, host-only cookie; the browser session expires after seven days. Tokens are never sent to client-side JavaScript or local storage. Expiring access tokens renew automatically when opening the editor and before publishing. Renewal preserves the original seven-day session limit and rechecks the account identity. If the refresh token is expired or revoked, sign-in is required again and the draft is preserved. Browser Web Locks serialize renewal across tabs where supported. Device flow is unused and can stay disabled. Mutation endpoints validate the exact configured Origin. API/auth responses use `no-store`.

Signing out deletes the browser session. To revoke the underlying OAuth grant, use [GitHub's authorized OAuth apps](https://github.com/settings/applications). Rotating `SESSION_SECRET` invalidates all Chhotu sessions.

## Validation

```sh
pnpm check
pnpm test
pnpm build
```

Tests cover token encryption and tampering, session expiry and account restrictions, OAuth state consumption and PKCE, mutation origins, timezone conversion, Unicode content, collection creation, duplicate timestamps/permalinks, branch races, retry recovery, incomplete GitHub trees, and signature reporting. GitHub requests in tests are mocked; they never create live commits.

`pnpm build` runs `astro build`, writing the Worker to `dist/server` and public assets to `dist/client`. The `@vite-pwa/astro` integration generates the manifest, service worker, and Workbox runtime in `dist/client`. `pnpm preview` serves the production build with Cloudflare's runtime; unlike development, this enables service-worker testing.
