## What's new in v0.9.13

A small release: four things that testing v0.9.12 turned up, all of them in the first screen of
Phase 1.

### Phase 1 opens on Google Drive

The assignment description tabs open on **From Google Drive**, and that tab is now first in the
row. Uploading from your computer is still there, one tab to the right — it is the fallback
rather than the usual case.

If you are not signed in, the Drive tab shows the sign-in prompt and **From Local Drive** sits
beside it, so nothing about being signed out blocks you from getting a rubric made.

Note that the box for pasting an assignment description as plain text lives under **From Local
Drive**, so pasting now takes one click first.

### The first button says what it does

It used to say **Generate Rubric**, which described the wrong step. Pressing it does not write
anything — it reads the assignment description, works out which deliverables are in it, and
hands you a checklist to confirm. Only after you tick rows and press the confirm button does any
rubric get written.

It now says **Analyze Description**, and the line underneath says what happens next instead of
promising a rubric in under a minute.

### The confirmation tick box is visible now

The tick box above **Deploy to Canvas** was a small check box under small grey text, so the
greyed-out deploy button below it looked broken rather than waiting for you. It is a bordered
panel now, with a line stating in plain words that ticking it turns the deploy button on. Once
ticked, it turns green and stops asking for your attention.

### Start Over always asks first

Start Over now shows a confirmation every time, not only when you have a rubric that would be
lost.

The reason is a misfire worth describing, because you may have hit it: the button sits in the
ribbon at the top, the ribbon reflows when you change the text size, and changing the text size
can slide Start Over underneath your cursor just in time for your next click. The session has no
way of knowing that happened, so the confirmation can no longer depend on what the session
holds.

The wording still changes with your situation — with nothing unsaved it tells you the screen is
being cleared rather than warning you about losing work that does not exist.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
