## What's new in v0.9.12

### Each rubric keeps its own change request

**This fixes a way of quietly rewriting the wrong rubric.** There was one Request Changes box
shared by every rubric in a run, and the button applied whatever was in it to whichever rubric
happened to be on screen. Type a request while Part 1 was showing, switch to Part 2, press the
button — and Part 2 was rewritten using instructions meant for Part 1. The result looked like a
perfectly good rubric, and nothing told you what had happened.

Every rubric now has its own box, kept as you move between them, and the card names the rubric
it belongs to. If you had changes queued in an earlier version, check that they landed where you
meant them to.

### Ask for all your changes, then apply them once

Work through the rubrics writing what you want changed in each, tick each one off, and apply
them all together. Eight revisions used to be eight separate waits; now it is one run with a
progress bar, and the button says how many it is about to change.

Anything you typed but did not tick is named before the run rather than quietly skipped — that
is the sort of thing you would otherwise only notice by reading a document that had not changed.

The list of rubrics at the top marks the ones carrying a request you have not applied yet, so
you can see where you are without clicking through all of them.

### Deploying is now the last thing on the screen

Opening Request Changes used to put the box **underneath** the deploy button, so the page read
as "deploy to Canvas, then describe your changes". The revision card now sits above the confirm
tick and the deploy button, which is where the one action you cannot undo belongs.

### Rubric titles are real headings again

In a document holding several rubrics, only the first title came through as a Heading 1 — the
rest arrived as ordinary bold text. Every title is now a proper heading, which also means the
document outline in Google Docs lists all of them, so you can jump between rubrics from the
sidebar instead of scrolling.

### Select all on the deliverables list

A **Toggle all** control, next to a count of what is selected, for ticking or clearing
everything at once. Same place and wording as the one in Canvas Extractor Tools.

### Also fixed

- The confirmation tick above the deploy button said "the rubric currently displayed above is
  ready for Canvas" while the button deployed all of them. It now names the number it covers.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
