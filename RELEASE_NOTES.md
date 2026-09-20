## What's new in v0.9.15

Your CSVs can now be saved before you deploy, the app stops shoving itself into the top of the
window, and a batch of smaller fixes that came out of a security, accessibility and efficiency
review of the changes.

### Save your CSV files before deploying

There is a **Save CSV files** link under the deploy button in Phase 1. It opens the same panel you
see after a deployment — **Save to my computer** or **Add to Drive** — but before anything is sent
to Canvas.

This is worth doing when a deployment might go wrong. If Canvas rejects the upload or your token
has expired, the work is still recoverable from a CSV you already have on disk. The files are the
same ones the deployment sends, and saving them changes nothing about the deployment.

The offer after a deployment no longer disappears for good once you use it. Saving to your
computer and then deciding you also want a copy in Drive used to mean re-running the whole
deployment; now only **No thanks** closes it, and the link reopens it.

### The window no longer squashes itself into the top of the screen

If the app ever slid its content up, leaving the blue title bar and the toolbar off the top and
white space below, that is fixed. The app was asking the page itself to scroll when it revealed a
new section, which moved everything. It now scrolls only the panel that should move, and the page
is pinned so it cannot move even if something asks.

### A rubric that starts with "=" is no longer treated as a formula

CSVs added to Drive are converted to Google Sheets, and Google treats a cell beginning with `=`,
`+`, `@` or `-` as a formula rather than as text. A criterion description starting with one of
those came out as an error message instead of the sentence you wrote. Those cells are now marked
as text on the way up.

Rating points are unaffected — a penalty worth **-5** is still the number -5, not text. Only the
Drive copy is adjusted; the file Canvas receives and the one saved to your computer are exactly
as generated.

### Your point style now reaches Canvas

Phase 1 lets you choose **Ranges** (10 to >8) or **Single** (10, 8, 6), and that choice sets a
column in the Canvas CSV. It was never being passed to the deployment, so every rubric was sent as
Ranges whatever you picked. Worth a look if you use Single.

### Smaller fixes

- **Start Over can be reached at large text sizes.** At 200% and above, the confirmation box could
  have its buttons off the bottom of the window with no way to scroll to them.
- **The Save CSV panel works properly with a keyboard.** Opening it used to throw you back to the
  top of the window, so the next Tab started from the title bar again.
- **Saving now says whether it worked.** For anyone using a screen reader, a failed Drive upload
  previously sounded exactly like a successful one — neither was announced at all.
- **"Add to Drive" explains itself when you are signed out**, instead of being greyed out with the
  reason hidden in a tooltip a keyboard cannot reach.
- **Filenames in a zip are readable again.** `Module 1: Discussion` was arriving as
  `Module_1__Discussion.csv` from some screens; every screen now produces `Module 1_ Discussion.csv`.
- A receipt saying your CSVs were saved no longer appears if you cancelled the save dialog.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
- **CSVs added to Drive arrive as Google Sheets.** To use one as a Canvas import again, open it
  and choose File → Download → Comma-separated values.
