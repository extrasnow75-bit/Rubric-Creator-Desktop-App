# Canvas Rubric Creator

A desktop app for Windows and macOS that turns an assignment description into a Canvas rubric,
converts existing rubric documents into Canvas CSV, and pushes them straight into a Canvas course.

Built by the Boise State eCampus Center. It is the sibling of
[Canvas Extractor Tools](https://github.com/extrasnow75-bit/canvas-extractor-tools) and follows
the same architecture.

## Installing

Download the installer for your machine from the
[latest release](https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App/releases/latest).
The release page has the install steps, including how to get past the warning Windows and macOS
show for in-house apps.

## What it does

**Part 1 — Create a rubric.** Paste an assignment description, or upload one as a Word, PDF or
Google doc. The AI you chose (Gemini or BoiseState.ai) drafts a four-level rubric which you can edit in place or revise by asking for
changes in plain English.

**Part 2 — Convert to CSV.** Turn a rubric document into the CSV format Canvas imports. Handles a
document containing several rubrics, converting each one.

**Part 3 — Upload to Canvas.** Push the CSV straight into a course's Rubrics list.

**Screenshot converter.** Turn a screenshot of an existing Canvas rubric back into an editable
rubric.

Every rubric can open in Google Docs or be saved to your computer. Parts 1 to 3 work without a
Google account — you only need one to browse Drive or create a Doc.

## Setting it up

Three things, all under **Initial Setup** in the app:

| | Needed for | Where to get it |
|---|---|---|
| **AI service key** — Gemini *or* BoiseState.ai | Everything AI-generated | Gemini: [aistudio.google.com](https://aistudio.google.com), free. BoiseState.ai: [boisestate.ai/api-keys](https://boisestate.ai/api-keys), expires every 90 days |
| **Canvas API token** | Uploading to Canvas | Canvas → Account → Settings → **+ New Access Token** |
| **Google sign-in** | Drive browsing and Google Docs | Optional — the app works without it |

**Choosing between them.** BoiseState.ai needs no Google account and keeps data inside the
university's service, but its API accepts text only: PDF rubric documents and the screenshot
converter need Gemini. It also draws on a monthly allowance. See `electron/ipc/boiseStateClient.ts`
for how it is adapted to the calls the app makes.

Generate a **dedicated** Canvas token for this app rather than reusing an existing one, and give
it an expiry date. Revoke it in Canvas when you stop using the app. The app has a "Remove Token"
button that clears its local copy.

## Where your credentials live

Your Canvas token and your Gemini and BoiseState.ai keys are encrypted into your operating system's keychain — Windows
Credential Manager or the macOS Keychain — and never leave your computer. Your Google sign-in is
stored the same way.

This is the main reason the app is no longer a website. A Canvas access token acts as you: it can
read enrollments, submissions, grades, student names and SIS IDs across every course you teach.
In a browser that token sat in `localStorage`, readable by any extension with host permissions.
Here it is held by the operating system, and the visible part of the app is never given it — the
window cannot make network requests at all, so there is nowhere for a credential to go even if
something went wrong inside it.

That closes the browser attack surface, which is the realistic risk. It does not defend against
malware already running as you on your own machine; nothing that stores a credential for later
use can.

## Developing

```bash
npm install
npm run dev        # launch the app with hot reload
npm run typecheck  # both processes
npm test           # unit tests
npm run build      # build + package installers into release/
```

Google sign-in needs a **Desktop app** OAuth client — a web client will not work with the
loopback redirect desktop apps use. See `electron/ipc/googleConfig.ts` for the setup steps, and
copy `.env.example` to `.env.local` for the client secret.

### How it is put together

```
electron/
  main.ts          window, lifecycle, IPC handlers
  preload.ts       the contextBridge — the app's real security boundary
  ipc/             everything that touches the network or a credential
src/               the React interface — no network access at all
resources/         app icons (icon.svg is the source; make-icon.py rasterises it)
```

The split is the design. Every network call — Canvas, Google Drive, Gemini, BoiseState.ai — happens in the main
process, and every credential is read there. The renderer is served from `file://` under a
Content-Security-Policy of `connect-src 'none'`, so it has no fetch, no XHR, no WebSocket and no
beacon. It asks the main process for things and draws the results.

Two consequences worth knowing before changing anything:

- **Nothing in `window.api` returns a credential.** Secrets travel renderer → main only; reads
  come back as `{ hasValue, hint }`. A method that returns one would be a bug.
- **`openExternal` is restricted to an allowlist** of hosts, not just `https:`. CSP does not
  govern top-level navigation, so an unrestricted `openExternal` is a working way to send data
  off the machine. See `electron/ipc/externalLinks.ts`.

### Releasing

Rewrite `RELEASE_NOTES.md` for the new version, then push a tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

The workflow builds Windows and both macOS installers, checks the notes name the tag, and
publishes the release. It needs one repository secret, `MAIN_VITE_GOOGLE_CLIENT_SECRET`.
