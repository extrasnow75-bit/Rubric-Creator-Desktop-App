# **Canvas Rubric Creator**

## Draft KB Article

*Companion article to [Canvas Extractor Tools](https://github.com/extrasnow75-bit/canvas-extractor-tools). Extractor Tools takes rubrics **out** of Canvas; this app puts them **in**. Rubrics extracted by one go back through the other unchanged.*

*Replaces: any instructions that describe the browser version of the Rubric App, including the step about installing a CORS browser extension. That step no longer applies to anything. (Add the link to the article being replaced.)*

# **Introduction**

The purpose of this tool is to save the IDC the work of building a rubric from scratch, reformatting one by hand into the shape Canvas will import, and then copying it into a course a row at a time.

Canvas Rubric Creator does three things, and you can start at whichever one matches what you already have:

* **Draft a rubric** from an assignment description, using the eCampus Center rubric template.
* **Rebuild a rubric from a screenshot** of one that already exists in Canvas.
* **Convert a rubric document into Canvas's CSV format and deploy it** straight into a course's Rubrics list.

**What changed in the latest version** is listed on the [release page](https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App/releases/latest), so this article does not carry version history.

What the tool produces is a **draft**. The AI writes the criteria, the rating language and the point values, and every one of those is a judgement call about how students will be graded. **The rubric is to be reviewed by the IDC and the FD before it goes into a live course.**

The app **adds** rubrics to a course. It never edits, replaces or deletes a rubric that is already there, and it never touches assignments, grades, submissions or students. A deployed rubric lands in the course's **Rubrics** list, unattached to any assignment — attaching it is a step you do in Canvas afterwards.

# **⚒️The Tool**

The Rubric App used to be a website. **This one is a desktop app that you install on your computer.** It does not require any coding tools or know-how to use.

**Download:** [Canvas Rubric Creator releases page](https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App/releases/latest)

The release page offers three files, and its own **Download** section at the top names them and links them directly. Take the one for your computer:

* **Windows:** `Canvas-Rubric-Creator-WINDOWS-<version>.exe`
* **Mac — newer (2020 and later, Apple Silicon):** `Canvas-Rubric-Creator-MAC-APPLE-SILICON-<version>.dmg`
* **Mac — older (2019 and earlier, Intel):** `Canvas-Rubric-Creator-MAC-INTEL-<version>.dmg`

**If your Mac is only a few years old, take the newer one.** Every Mac sold since late 2020 uses Apple Silicon, so that is the right file for most people.

To be sure: click the Apple menu, then **About This Mac**. A line reading **Chip — Apple M1**, M2, M3 or M4 means the newer file. A line reading **Processor** with Intel in it means the older one. An Intel Mac has no "Chip" line at all, so which line you see is itself the answer.

The **Assets** section further down the release page holds the same three files. Ignore the two **"Source code"** links beside them — GitHub adds those to every release automatically, and they are not the app.

**On Windows:** double-click the `.exe` to install. Windows will show a blue screen saying **"Windows protected your PC."** Click **More info**, then **Run anyway**. It appears because the app was built in-house rather than distributed through the Microsoft Store, not because anything is wrong with it. You will see it again each time you install a new version.

**On a Mac:** open the `.dmg` and drag **Canvas Rubric Creator** into the Applications folder shown beside it. The first time you open it, Apple hasn't verified this app, so your Mac will initially refuse to open it — usually saying the app *"is damaged and can't be opened"* or is from an unidentified developer. The app is fine; macOS says this about anything not distributed through the App Store. Open **Terminal** (Applications → Utilities), paste this line, and press Return:

```
xattr -dr com.apple.quarantine "/Applications/Canvas Rubric Creator.app"
```

Then open the app normally. You need to do this once for each version you install.

## 🔑What You Need Before You Start

Everything here goes in the **Initial Setup** panel on the app's first screen. Each one is remembered, so this is a first-run job, not a daily one.

**1\. A Gemini API key — required for everything the AI does.** That is drafting a rubric, reading a screenshot, converting a document to CSV, and suggesting a fix. Without it the app can still deploy a CSV you already have, and nothing else.

> Go to [Google AI Studio](https://aistudio.google.com), sign in with your Boise State account, click **Get API key** on the left, then **Create API key**. **Copy it immediately.** The key is free for this level of use.

The app checks the key as soon as you paste it, and tells you there and then whether it works.

**2\. A Canvas access token — required to deploy to Canvas.** A token is a long string of characters that acts as an ID and a password in one. You create your own:

> In Canvas, go to **Account → Settings**, scroll to **Approved Integrations**, click **\+ New Access Token**, give it a purpose such as "Canvas Rubric Creator," **set an expiry date**, and click **Generate Token**. **Copy the token immediately** — Canvas will not show it to you again.

The token gives the app exactly the Canvas access you already have — no more. It is stored encrypted on your own computer and is never sent anywhere except Canvas.

**Generate a token specifically for this app rather than reusing one you already have**, give it an expiry, and revoke it in Canvas when you stop using the app. **Remove Token** in the app clears the copy on your computer; revoking in Canvas is what kills the token itself.

**3\. Google sign-in — only if you want Google Doc output or the Drive browser.** Google sign-in is currently limited to an approved list of accounts. **Contact the eCampus Center to be added before your first use**, or sign-in will fail with a message about the app not being verified. Everything else works signed out: you can draft a rubric, save it to your computer, and deploy to Canvas with no Google account at all.

## 🖥️Why a Desktop App and Not a Website?

A Canvas access token acts *as you* in Canvas. Anyone holding one can read enrollments, submissions, grades, student names, emails and SIS IDs across every course you teach. That is FERPA-protected data, and the single most sensitive thing this app handles.

In the web version that token sat in the browser's storage in plain text, where any browser extension with permission to read the page could reach it. Moving to a desktop app is what closes that. The token now lives in your computer's own keychain — Windows Credential Manager or the macOS Keychain — and the visible part of the app is never given it. The window has no ability to make network requests at all, so there is nowhere for a credential to go even if something went wrong inside it.

Being honest about the limit: this closes the *browser* attack surface, which is the realistic risk. It does not defend against malware already running as you on your own machine. Nothing that stores a credential for later use can.

# **✅What The App Does**

The first screen asks one question: **do you already have draft rubric(s)?** Your answer picks the path.

## Assignment description → rubric *(answer: No)*

Paste an assignment description, or upload one as a Word document, PDF, plain text file, or a Google Doc from your Drive. Three settings sit above the box:

* **How many rubrics?** — *One rubric*, or *Several rubrics* if the description covers a set of assignments.
* **Total points** — what the rubric should add up to.
* **Point style** — *Ranges* (`10 to >8`) or *Single* values (`10, 8, 6`). Ranges is what Canvas itself writes and what Extractor Tools produces.

The app drafts a four-level rubric on the eCampus Center template. From there you can **edit any cell in place**, or **ask for changes in plain English** — "make the top level more demanding," "add a criterion for citation format" — and it redrafts. When it is right, **Open in Google Docs** puts it in your own Drive as a real Doc with the table intact, or **Save to this computer** writes a file you can open in a browser or Word without any Google account.

## Screenshot → rubric *(answer: No)*

For a rubric that exists in Canvas but not in any document you can edit. Take a screenshot of the **full rubric**, then drop it in, paste it from the clipboard, or choose the file. The app reads it and rebuilds it as an editable draft rubric, which then behaves exactly like one it drafted itself.

## Rubric document → Canvas *(answer: Yes)*

Upload the rubric document — a **Word (.docx) or PDF** file, from your computer or from Google Drive — and give it the URL of the course you want to deploy to. The app confirms the course by name before it does anything, so a mistyped course number is caught before it becomes a rubric in somebody else's course.

Then **Analyze Draft Rubric(s) and Deploy To Canvas**. The app converts each rubric in the document into Canvas's CSV format and pushes it. A document with several rubrics in it is handled as several rubrics.

While it runs you get a progress bar, an elapsed and estimated time, a **Cancel** button, and a **Deployment Timeline** naming each step as it happens. When it finishes you get a count of what succeeded and what failed, a link straight to the course's Rubrics page to check, and an offer to download the CSV files.

**Copy Logs**, in the Deployment Timeline header, puts the whole log on your clipboard, with the app version, the date and time, the course and the success and failure counts written at the top. That is the thing to paste into a message when you need help with a failure. Your Canvas token is not in it and cannot be.

## When Canvas refuses a rubric

The app groups failures by cause, so ten rubrics failing for one reason is explained once rather than ten times, and each cause comes with the specific thing to do about it.

Where the problem is in the file itself — a blank point value, a points column holding `10-8` where Canvas wants `10`, a missing header row — a **Suggest a fix** button appears. The app sends the rubric and Canvas's own complaint to the AI and shows you a corrected version, with every changed cell listed and **point value changes called out separately at the top**, because those are the ones that change what a student is graded on.

Nothing is applied on its own and nothing reaches Canvas until you click. Before you are shown a suggestion at all, the app checks it: a suggestion that still would not load into Canvas, or that quietly drops a criterion, is thrown away without ever reaching your screen.

# **🛑What The App Does Not Do**

* **It does not read rubrics out of Canvas.** That is [Canvas Extractor Tools](https://github.com/extrasnow75-bit/canvas-extractor-tools). This app is the other direction.
* **It does not change a rubric that is already in Canvas.** Every deploy adds a new one. If you deploy a corrected version of the same rubric, you will have two, and removing the old one is a manual step in Canvas.
* **It does not attach a rubric to an assignment.** The rubric lands in the course's **Rubrics** list; attaching it to the assignment is done in Canvas.
* **It does not produce a `.docx` file.** Output is a Google Doc or a local file you can open in a browser or Word.
* **It does not judge whether the rubric is any good.** The AI has the assignment description and nothing else — not the course, not the learning outcomes, not what the FD actually cares about.
* **It does not guess at point values it cannot read.** `>90` or `<70` on their own name one edge of a band and no maximum, and `1,000` means a thousand in some countries and one in others. Rather than pick a number that might be wrong, the app refuses the file, names the ratings involved, and offers the repair.

# **👷What You Have To Do After**

* **Read the rubric.** All of it. The criteria, the rating language, and the point values.
* **Check the point totals** add up to what the assignment is worth.
* **Attach the rubric to its assignment** in Canvas, and set *Use this rubric for assignment grading* if that is what you want.
* **Check any rubric marked "Deployed from an AI repair."** The app says so explicitly in the results, because a repaired file had at least one value the app could not read, and the AI's replacement for it is a guess.
* **Delete superseded rubrics** in Canvas if you deployed more than one version.
* **Review the rubric with the FD** before the course goes live.

# **📋How To Use It**

**First run only:** open **Initial Setup** and paste in your Gemini API key and your Canvas token. If you want Google Doc output or the Drive browser, click **Sign in with Google** — your normal browser opens, you sign in there, and the app picks it up. All three are remembered.

**Every run:**

1. Answer **do you already have draft rubric(s)?**
2. **No** → pick **Assignment Description to Rubric(s)** or **Screenshot to Rubric(s)**, set how many rubrics, the total points and the point style, and give it the description or the screenshot.
3. **Yes** → upload the rubric document, from your computer or from Drive.
4. Paste the target course URL, e.g. `https://boisestatecanvas.instructure.com/courses/12345`. Copy it from your browser's address bar while you are in the course. The course name appears once the app confirms it — check it is the course you meant. The box is prefilled with the course you used last time, so usually only the number needs changing.
5. Review the draft. Edit cells directly, or ask for changes in plain English.
6. Save it — **Open in Google Docs**, or **Save to this computer** — and deploy.
7. Follow the **Verify at Canvas Rubrics page** link and look at what actually landed.

The app also has a straight-through route: **Part 1** creates the rubric, **Part 2** converts it to CSV, **Part 3** deploys it. The Yes/No question on the first screen is the shortcut through the same three steps, and either way the Canvas end of it is identical.

# **🔧Troubleshooting**

| What you see | What to do |
| :---- | :---- |
| "Canvas rejected your access token" | Canvas tokens expire and can be revoked. Generate a new one under **Account → Settings** and save it in Initial Setup. |
| "Your Canvas account is not allowed to add rubrics to that course" | You need to be a teacher or designer in that course. Check you are in the course you think you are. |
| "Canvas has no course with that ID" | Check the number at the end of the course URL. This is the error a typo produces. |
| "That course is on a different Canvas site" | The course URL points at a different institution's Canvas than the one saved in Initial Setup. |
| "Some ratings do not have a point value Canvas can use" | The app is refusing to deploy rather than guess. It names each rating involved — fix them in the document and upload it again, or take the **Suggest a fix** offer. |
| "Canvas is rate-limiting the app" | Wait a minute and deploy again. Deploying fewer rubrics at a time also helps. |
| A rubric deployed but the points are wrong | Check whether the results said **"Deployed from an AI repair."** If so, the AI supplied a value the document did not have. Correct it in Canvas. |
| Two copies of the same rubric in Canvas | Every deploy adds a new rubric. Delete the one you do not want, in Canvas. |
| Google sign-in stops working, or asks again after about a week | Expected. Google expires sign-in weekly for apps still in testing. Sign in again from Initial Setup. |
| Google shows a warning screen the first time you sign in | Click **Advanced**, then **Go to Canvas Rubric Creator**. The app has not been through Google's public review, which is not required for internal use. |
| Google sign-in fails saying the app is not verified, and there is no **Advanced** link | Your Google account has not been added to the approved list. Contact the eCampus Center. |
| A Word document will not convert | Make sure you are on the current version — this was broken in versions before 0.9.2 for every Word document. |
| The Gemini key is rejected | Check for a stray space at either end. If it still fails, generate a new key in AI Studio. |
| Text is too small to read | Use the **Text size** buttons at the top of the window — **−**, the percentage, and **+**. Clicking the percentage returns it to 100%. **Ctrl** and **+** or **−** (**Cmd** on a Mac) do the same, and **Ctrl/Cmd 0** resets. The setting is remembered. |
| macOS says the app "is damaged and can't be opened" | The app is fine — Apple hasn't verified it, so your Mac refuses it by default. Run the Terminal line under **The Tool** above, then open it again. |
| Something failed and you need help | Click **Copy Logs** in the Deployment Timeline header and paste the result into your message. It carries the version, the time, the course and the counts. |

# **🔄Updates**

The app checks for a newer version when it starts and shows a bar at the top if one exists. You can also check any time from **Help Center → Updates → Check for updates**, which tells you plainly if the check itself failed rather than reporting that as good news.

Updates are never installed automatically. Download the new version and install it over the top of the old one — your Gemini key, Canvas token and Google sign-in are all kept.

**On Windows: do not uninstall the old version first, and accept the folder the installer offers.** The installer finds the existing copy and replaces it. If you browse to a different folder instead, you end up with two versions installed side by side and no way to tell which one you are opening. **Close Canvas Rubric Creator before you run the installer**, or Windows reports that files are in use and the install fails.

**On a Mac:** drag the new app into Applications and choose **Replace** when asked, then run the Terminal line under **The Tool** again — it is needed once per version.

# **📄Related References**

* [Canvas Extractor Tools](https://github.com/extrasnow75-bit/canvas-extractor-tools) — the companion app, for getting rubrics and course content *out* of Canvas
* [How To Manually Upload a Rubric CSV File To Canvas](https://docs.google.com/document/d/1vPzRVs-qdIwhOR_IkFEjZlKw-pobiRYGZgjQm8eUZCY/edit?usp=sharing) — the fallback when a deploy will not go through
* [Rubric Example Point Ranges](https://docs.google.com/document/d/1YAs6TdSfRIpRXyKyQWSFc-VtgZ39gbYgnWdVtHZBDT4/edit?tab=t.0#heading=h.4v5p1vp9zrcz) — how point ranges are written
* [What a Gemini API Key Is, and How and Why to Get One](https://docs.google.com/document/d/1Ce1gOTozOD3TGd8ntPz3oEWJjU-Y07K2akuIJHXnzHk/edit?tab=t.0#heading=h.xaazhwt982j4)
* [How do I manage API access tokens in my user account?](https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account) — Instructure's own documentation
* [Selected Training Documents](https://drive.google.com/drive/folders/1JHSAm6uXphyZSx6I3hUT70l-IwW6T4FK?usp=sharing)
* eCampus Center rubric template *(add link)* — the four-level layout the drafts are built on

# **💭Feedback**

If you would like to request a new feature or need to report a bug, use the [App Suggestions Document](https://docs.google.com/document/d/1UALeUcbTKGx6ytt7tY4aCqja28rvRdIR-tW8nGYhFn8/edit?tab=t.0), which is also linked from inside the app under **Help Center**.

---

# **🔩Maintenance**

*Audience: whoever takes over this app. You do not need a computer science degree — you need to be comfortable installing things, running commands, and reading code with an AI assistant's help. This section explains **why** things are the way they are, because most of the traps here are invisible until you trip over them.*

## Getting it running

**Repo:** [github.com/extrasnow75-bit/Rubric-Creator-Desktop-App](https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App)

You need [Node.js](https://nodejs.org) (the LTS version) and git. Then:

```
git clone https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App.git
cd Rubric-Creator-Desktop-App
npm install
npm run dev
```

| Command | What it does |
| :---- | :---- |
| `npm run dev` | Run the app locally with live reload |
| `npm run typecheck` | Check both halves for type errors. **Run before committing.** |
| `npm test` | Run the test suite once. **Also run before committing.** |
| `npm run test:watch` | Re-run tests automatically as you edit |
| `npm run build` | Build real installers into `release/` |

`npm run dev` will not catch every problem — see "Things that only break in the real build" below.

## How the app is put together

It's an **Electron** app: a Chrome browser and a Node.js program bundled together and shipped as a desktop app. That gives you two halves, and the difference between them is the single most important thing to understand here.

| | What it is | Where it lives |
| :---- | :---- | :---- |
| **Main process** | The Node.js half. Can touch the filesystem, the network, and the operating system. | `electron/` |
| **Renderer** | The Chrome half. The user interface — React and Tailwind. | `src/` |

The renderer is **sandboxed and has no network access at all**. Its Content-Security-Policy sets `connect-src 'none'`, which means no fetch, no XHR, no WebSocket, no beacon. When the UI needs something done it asks the main process through a fixed list of messages defined in `electron/preload.ts`. This is called **IPC**.

**Every call to Canvas, Google and Gemini happens in the main process, and every credential is read there.** This is not a style preference — it is the entire reason the app was moved off the web. If you find yourself adding a `fetch()` inside `src/`, stop; that is the wall coming down, and the CSP will block it anyway.

## The five rules not to break

Each one is load-bearing, and removing any of them fails **silently** — the app keeps working and just becomes unsafe.

**1\. Nothing in `window.api` may return a credential.** Secrets travel renderer → main only. Reads come back as `{ hasValue, hint }` — a boolean and the last four characters. The Canvas token is never handed to the renderer at all, which is deliberately stricter than Canvas Extractor Tools, and it is why the Canvas IPC calls take no token argument: main loads it from the keychain at call time. A method that returns a secret is a bug, not a convenience.

**2\. Canvas requests are host-pinned.** Main derives the Canvas origin from the saved course URL, requires `https:`, and attaches the `Authorization` header only to an exact host match. Rubric titles and AI-generated text are never interpolated into a URL.

**3\. `openExternalSafely()` uses an exact-host allowlist** (`electron/ipc/externalLinks.ts`), not just a `https:` check. CSP does not govern top-level navigation, so an unrestricted `openExternal` is a working way to send data off the machine — `https://attacker/?data=…` is all it takes. Note the comment in that file about why a suffix check is not good enough: `endsWith('.google.com')` accepts `google.com.attacker.example`. **An allowlist miss is silent** — the click just does nothing — so when you add a link to a new host, add the host at the same time.

**4\. `savePaths.ts` — only write to a path the save dialog actually issued.** The renderer sends a save location back as an ordinary string, and a string proves nothing about where it came from. Main remembers the paths it handed out and refuses anything else.

**5\. Keychain or nothing.** If `safeStorage.isEncryptionAvailable()` returns false, the app refuses to store the credential and says so. There is no plaintext fallback, and there must never be one that looks like success.

One consequence of rule 1 is worth spelling out, because it is not obvious. Since the renderer never sees the token, it cannot tell you whether the token **works** — only that one is stored. "Token saved" meant nothing more than "a string reached the keychain," and a revoked or mistyped token looked exactly like a good one until the first deploy failed. `verifyToken` closes that by having main *use* the token at launch against the remembered course; a successful course lookup is the proof, because that request carries the token. Any future "is this credential still good?" question has to be answered the same way — in main, by using it — not by handing the secret to the UI so it can check for itself.

## The AI rule: it proposes, a deterministic check disposes

`electron/ipc/csvRepair.ts` is the one place where AI output can reach Canvas, and it is built on the assumption that a model asked to fix a rubric CSV will always return something that *looks* like a fixed rubric CSV. The failure that matters is not an obvious mess — it is a file that deploys cleanly and quietly grades students differently from the one the author wrote.

So nothing in that file asks the model what it changed. Everything is computed:

1. **The parse gate** runs the proposal through `buildRubricPayload` — the same function the real deploy uses — so "this will load into Canvas" is demonstrated, not assumed.
2. **The no-loss gate** refuses a repair that drops a criterion. Note what this costs: a repair that *renames* a criterion is also refused, because from the outside a rename is indistinguishable from a deletion plus an addition. Canvas does not reject rubrics over criterion names, so that is not a fix worth the risk.
3. **The diff** is computed cell by cell from the two files, never from the model's own account of its work — which is a claim, and can under-report.

**These gates run in the main process on purpose.** A proposal that fails one never crosses IPC, so there is no path by which the renderer can display — let alone deploy — a repair that was not checked. If you move any of this into `src/`, you have removed the guarantee.

Point-value changes are separated out in the UI for the same reason. A structural fix costs nothing if it is wrong — Canvas either accepts the file or it doesn't. A changed number changes a grade, and no amount of validation can tell whether it is the number the author meant.

## What the model writes, and what it only copies

Two different jobs share one word — "AI" — and confusing them is the easiest way to do real damage here.

**Drafting is authorship.** The model is handed an assignment description and writes rubric language that did not exist before. `RATING_BREVITY_RULE` in `electron/ipc/gemini.ts` governs that language: one sentence per rating, twenty words at most and ten to fifteen aimed for, with every level unmistakably different from the ones directly above and below it. It is attached to exactly two prompts — `generateRubricFromDescription` and `applyRubricChanges`.

**Extraction is transcription.** A rubric read out of a Word document, a PDF or a screenshot is already written and already approved by whoever teaches the course. It is copied **verbatim**, and none of the brevity instructions go anywhere near those prompts.

**Do not tidy this up by applying the brevity rule everywhere.** It reads like an oversight — the same constant is missing from the extraction prompts beside it, which otherwise look much the same — and adding it there would make the app quietly shorten an instructor's own rubric on the way through. Nothing would error. The document would convert, the CSV would deploy, Canvas would accept it, and the language students are graded against would no longer be the language the author wrote. The rule is a named constant with a comment saying this, so that its absence looks deliberate when you find it.

The word budget itself is a judgement rather than a standard: twenty words is roughly what a Canvas rating column shows without scrolling. If eCampus settles on a different house style, it is two numbers in that one constant.

## Why conversion happens in groups of eight

`BATCH_RUBRIC_LIMIT = 8` in `src/services/geminiService.ts` is what makes a large document work, and it is squeezed from both sides.

**From above — the output ceiling.** A model response is capped at 64k tokens, shared with its thinking tokens, and a batch extraction is all-or-nothing: one truncated reply loses every rubric in it, including the ones that had already finished inside it. A 26-rubric document demonstrated that by failing four minutes in with `Unterminated string in JSON at position 126176`. Raising the limit makes that failure likelier and costs a whole group each time it happens.

**From below — every request carries the whole document.** The cost driver is the number of calls, not the number of rubrics. Converting one rubric at a time means sending the entire file once per rubric: a 26-rubric document sent itself 27 times, with a six-second pause between each, which is where those four minutes went. The same document now takes four calls.

Both screens go through one orchestrator, `generateCsvsChunked`. That is not tidiness. Part 2 used to carry its own copy of the conversion loop and never batched at all, even for small documents — a three-rubric document took four calls where two would do — and it looked correct the whole time, because it produced correct CSVs. A second copy of this loop is how that comes back.

**`alignByTitle` refuses to guess, and that is the point.** A group asks for eight rubrics by name and gets some number of rubrics back. Pairing them up wrongly is the worst thing this app could do: a CSV filed under the wrong title deploys cleanly, looks right in Canvas, and grades students against somebody else's criteria. So it matches by normalised title; it falls back to document order **only** when nothing matched by title *and* the counts are equal, which is the signature of a model that returned the right rubrics with reworded headings; and in every other case it leaves a `null`, which costs one extra call for that one rubric and is never ambiguous. A *partial* title match deliberately does not fall back to position — a partial match means the two lists disagree about their contents, so position proves nothing.

That matching lives in `src/utils/rubricBatching.ts`, apart from the orchestration, for one reason: the orchestration cannot be tested without a live Gemini key and an Electron bridge, and the matching can. `rubricBatching.test.ts` pins it, including the "only some names matched" case. If you change the matching, change that test first and watch it fail.

## Two bugs that shaped the code — read before touching either

**1\. `parseFloat(x) || 0` deployed real rubrics worth zero.** A rating whose points cell held `>90`, `N/A` or nothing parsed as `NaN`, and `|| 0` turned that into `0`. Canvas accepts a zero without complaint, so there was no error anywhere: a criterion worth ninety points sat in a live course worth nothing, and the first sign of it would have been a student's grade.

`parseRatingPoints` in `electron/ipc/canvasUtils.ts` replaced it, and it is a **closed grammar** — three exact patterns, and anything else returns `null` and refuses the file:

| Notation | Yields | Why |
| :---- | :---- | :---- |
| `4 to >3 pts` | `4` | Canvas's own display form, and what Extractor Tools writes. The stored value is the band's top; the `>3` just restates the rating below. |
| `4-3.5 points` / `40–50 pts` | the larger number | A dash range, either way round. |
| `10 pts` | `10` | A plain value, with or without a unit. |
| `>90`, `<70` | refused | One edge of a band and no maximum. |
| `1,000` | refused | That comma is a thousands separator in some places and a decimal point in others. |

**The first attempt at this fix reintroduced the same class of bug.** It scanned for digit runs and took the largest, which read `.5 pts` as **5** and `1,000` as **1** — silently wrong values, exactly what the function exists to prevent. If you extend this, extend the grammar with a new anchored pattern and a test. Do not make it permissive. A visible refusal beats a quietly wrong grade every time.

**2\. An error message got routed to the wrong branch by a criterion name.** `src/utils/diagnoseCanvasError.ts` matches on wording, and its "Canvas server error" rule tests for `\b5\d{2}\b` — any three-digit number starting with 5. The local validation message quotes the criterion names it could not read, so a rubric with a criterion called **"Meets EDUC 502 outcomes"** reported a local file problem as a Canvas outage, advised a pointless retry, and suppressed the repair button. The fix was to test for the local message *first*, at the top of the function. **Order matters in that file** — anything new that quotes user text belongs above the pattern rules, not below them.

## Things that only break in the real build

`npm run dev` and the installed app differ in ways that will bite you.

* **The Content-Security-Policy is only injected at build time.** A Vite plugin in `electron.vite.config.ts` adds it with `apply: 'build'` so live reload isn't broken in development. You will not see CSP violations until you build. Open DevTools in a packaged build and confirm the console is clean — that is the proof no renderer code is still calling the network.
* **Every `file://` URL has the origin `"null"`.** In dev the UI is served over `http://localhost` and has a normal origin; in the packaged app it is loaded from disk, so its origin is the literal string `"null"` — and so is every other local file's. A navigation guard that compares origins protects nothing in production while passing every test in dev. `isOwnPage()` compares the full file path instead.
* **Anything loaded from a CDN will not load.** Tailwind, the Inter font and the pdf.js worker are all bundled for this reason. If you add a library, bundle it.

## Interface patterns that look like style and are not

Three things in `src/` read as fussy or redundant and are load-bearing. They fail as silently as the security rules do: the app keeps working for anyone using a mouse and a screen, and stops working for anyone who is not.

* **A file input is hidden with `opacity-0` and stretched over its drop zone — never with `display: none`.** `display: none` takes an element out of the tab order, so a "drop a file here, or click to browse" area hidden that way cannot be reached by keyboard at all: Tab goes straight past it and there is no way to load a document. The real input sits on top of the zone as `absolute inset-0 w-full h-full opacity-0`, carries the visible wording as its `aria-label`, and gets Enter and Space for free because it is a genuine `<input type="file">`. Do not replace it with a `<div onClick>` or a wrapping `<label>`; both look identical on screen and neither is focusable.
* **A live region is mounted empty and stays mounted for the whole run.** `role="status" aria-live="polite"` announces *changes* to an element the screen reader is already watching. An element that appears with its text already inside it is a new node rather than a change, and is often not announced — the failure that looks most like success, because the correct markup is right there in the DOM. Each of the three long-running screens keeps one empty `sr-only` span for the duration of a run and writes into it when there is something to say.
* **A dialog's close callback is held in a ref, not in the effect's dependency list** (`src/hooks/useDialogFocus.ts`). Callers pass an inline arrow — `onCancel={() => settle(null)}` is one — which is a new function on every render of the parent. An effect that depends on it tears down and re-runs on every one of those renders, and this effect's teardown **restores focus to whatever opened the dialog**. That throws focus out of the panel mid-keystroke, repeatedly, with nothing visibly wrong in the render output. The ref is what stops the effect from having an opinion about that identity.

## Where to change things

| If you want to change... | Start here |
| :---- | :---- |
| What the AI is asked for — rubric drafting, screenshot reading, CSV conversion, repair | `electron/ipc/gemini.ts` |
| How many rubrics go in one conversion call, and which returned CSV belongs to which rubric | `src/services/geminiService.ts`, `src/utils/rubricBatching.ts` |
| How a CSV becomes a Canvas rubric, and which point notations are understood | `electron/ipc/canvasUtils.ts` |
| The Canvas requests themselves | `electron/ipc/canvas.ts` |
| The gates on an AI repair | `electron/ipc/csvRepair.ts` |
| The wording of a Canvas failure, and whether the repair is offered | `src/utils/diagnoseCanvasError.ts` |
| The rubric document that goes to Drive or to disk | `electron/ipc/rubricHtml.ts` |
| Reading a Word document | `electron/ipc/docxText.ts` |
| Google sign-in and Drive | `electron/ipc/googleAuth.ts`, `electron/ipc/googleDrive.ts` |
| Which hosts a link may open | `electron/ipc/externalLinks.ts` |
| Help Center text, and the KB article link | `src/components/HelpCenter.tsx` |
| Initial Setup — keys, token, course URL | `src/components/Dashboard.tsx` |
| Focus, Escape and Tab behaviour in any dialog or drawer | `src/hooks/useDialogFocus.ts` |
| Colours, buttons, contrast rules | `.claude/DESIGN_SYSTEM.md` — read it before changing a colour |
| The app icon | Edit `resources/icon.svg`, then re-run `make-icon.py` |
| This article | `docs/kb-article-draft.md` — then regenerate the Google Docs copy (below) |

## Keeping this article

The source of truth is `docs/kb-article-draft.md`. The `.html` beside it is generated — edit the markdown, then rebuild it:

```
python3 docs/md2doc.py docs/kb-article-draft.md docs/kb-article-draft.html \
  "Canvas Rubric Creator — Draft KB Article"
```

To get it into Google Docs: **Drive → New → File upload**, upload the `.html`, then right-click it and choose **Open with → Google Docs**. Docs converts it on open, tables and all.

`md2doc.py` exists because Google Docs' HTML importer is not a browser. It ignores stylesheets, so every style is inline; it sizes table columns from the first row without expanding spans, so every table gets a flat header row and an explicit `<colgroup>`; and it turns a paragraph border into a stray grey rule, which is why a blockquote is rendered as a one-cell table instead. Those three rules are the same ones `rubricExport.ts` follows in Canvas Extractor Tools, and each was learned by shipping a document that came out wrong.

**`HELP_CENTER_ARTICLE_URL` in `HelpCenter.tsx` currently points at the Google Doc draft of this article, not at Confluence.** When the Confluence page exists, swap it for the short `/wiki/x/` form, which survives the page being renamed or moved between spaces; the long `/wiki/spaces/…/pages/…` form does not. Both hosts are already on the allowlist in `externalLinks.ts`, so nothing else has to change. Setting the constant back to `null` hides the card, which is better than leaving a link that 404s.

## Secrets and the Google consent screen

**This is the part most likely to go wrong under a new maintainer.**

The Google client secret is **not** in the repo. On your machine it lives in `.env.local` (gitignored) as `MAIN_VITE_GOOGLE_CLIENT_SECRET`; when GitHub builds a release it injects a **GitHub Actions secret** of the same name. Two consequences:

1. **Actions secrets do not follow a repository when it moves.** If this repo is transferred to the eCampus org, the secret must be added again on the other side or builds will quietly ship with Google sign-in broken.
2. **Because the installers are public, anyone can extract that client secret from a release.** Treat it as public. The real boundary is the control below.

**Do not publish the OAuth consent screen. It must stay in "Testing."** Every user is added by hand under **Test users** in the Google Cloud console — that is what onboarding someone means, and it is the thing that stops an extractable client ID and secret from being usable by anyone outside the approved list. Combined with PKCE, it is what makes public distribution acceptable. The cost is the weekly re-sign-in, which is a Google restriction on testing-mode apps and not a bug.

Google sign-in needs a **Desktop app** OAuth client. A web client will not work with the loopback redirect desktop apps use. Setup steps are in `electron/ipc/googleConfig.ts`.

**Keep the scopes minimal.** `drive.file` is "only files this app created"; `drive.readonly` is what the Drive browser needs to show you a document to import. Anything broader triggers a Google verification review.

## Releasing a new version

1. **Bump `version` in `package.json`.**
2. Rewrite `RELEASE_NOTES.md` as a "What's new in vX.Y.Z" list, written for the people installing the app — what they will see differently, not file names. `git log vPREV..HEAD` is the source. **The release job refuses to publish unless this file names the tag being released**, so a stale list cannot ship under a new heading.
3. Commit, then tag it: `git tag v1.1.0` and `git push origin v1.1.0`.
4. Pushing the tag triggers `.github/workflows/release.yml`, which runs the typecheck and the tests, builds the Windows installer and both macOS disk images, renames them to the friendly names users see, splices `RELEASE_NOTES.md` into the release notes, and publishes all three on one release. Takes about five minutes.
5. **Confirm the run actually started**, not merely that a run exists — open the Actions tab and check it has jobs in it. Then check the release page.

If you cannot push a tag from wherever you are working, the same thing can be done from the web: **Releases → Draft a new release → Choose a tag → type the new tag → "Create new tag: … on publish" → Target: `master` → Publish.**

**Do not skip step 1.** It is the one mistake here that does not announce itself. Tag a release without bumping `version` and everything appears to work — the build passes, the release publishes, the installer downloads and installs. But every copy already out there compares its own version against the newest release, sees the same number, concludes it is current, and never shows the update banner. The fix reaches nobody and nothing reports an error.

**A workflow file GitHub cannot parse fails in a way that looks like nothing went wrong.** Nothing built between v0.9.1 and the fix, and the cause was a shell comment. A `run:` block contained an empty `${{ }}` as an illustration of the syntax it was warning you not to use; GitHub scans `run:` blocks for template expansions and does not care that the line is a comment, so it rejected the entire file. Three things about that failure are worth knowing, because not one of them points at the cause:

* The tag still published a **release page with no installers on it** — GitHub creates the release from the tag whether or not any workflow runs.
* A rejected file has no jobs to fail, so runs finished in the same second they started and the Actions list showed a duration of **−1s**. **A run with zero jobs is the signature.**
* GitHub could not read the triggers either, so it created a failed run on **every push to every branch**, for a workflow that only fires on tags. Fifteen red runs, none of which reached a runner.

So: never put `${{` inside a `run:` block, not even in a comment, and after pushing a tag open the run and confirm it has jobs before you walk away from it.

Two things about the release page that are already settled, so nobody re-litigates them:

* **The Assets list cannot be reordered.** GitHub sorts release assets alphabetically by filename, regardless of upload order. This was tested directly: the `.exe` was uploaded first, given the lowest asset id, and still listed third. The **Download** section at the top of the notes is what leads people to the right file, and it lists Windows first.
* **The in-app update check only notifies.** It never downloads or installs. Real auto-update needs code signing, and the builds are unsigned.

## Known gaps and open items

* **The Canvas round trip is proven.** A ten-rubric Word document was converted and deployed to a live Canvas course in full on 18 September 2026 (v0.9.3). Everything before that release had only unit tests behind it.
* **Grouped conversion has not been run by a human against an installed build.** The grouping and the title matching are covered by unit tests, and the 26-rubric document that prompted them predates the fix. Converting a document of more than eight rubrics in an installed copy — and watching what happens to a rubric the group does not answer for — is the next thing to test.
* **The rating word budget has not been checked against eCampus's own standards.** Twenty words maximum, ten to fifteen aimed for, was set against the width of a Canvas rating column. Whether it reads right to an instructional designer is a judgement nobody has made yet.
* **Builds are unsigned** on both platforms, hence the SmartScreen warning and the `xattr` line. Removing those needs a paid Apple Developer identity and a Windows code-signing certificate.
* **`HELP_CENTER_ARTICLE_URL` points at the Google Doc draft**, not the published Confluence page. See above.
* **The Firebase project from the web version** (`updated-rubric-creator`) can be deleted once this app is in use — nothing in the desktop app touches it.
* **An Internal OAuth client** through a Boise State Workspace Cloud project would remove the test-user list and the weekly re-sign-in. That is the upgrade path if the approved list becomes a burden.
* **Transfer to the eCampus GitHub org** — remember the Actions secret.
