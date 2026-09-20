## What's new in v0.9.11

### You choose what gets a rubric, before anything is written

Paste an assignment description and press Generate, and the app now reads it first and tells you
what it found. If the assignment has separate parts — Part 1, Part 2, a table of deliverables —
you get a list of them, and you tick which ones should get a rubric of their own.

Nothing is generated until you press the button on that list. The app has only read the
description at that point, so a part it identified wrongly costs you a tick box rather than a
rubric you have to throw away.

Each row has a name and a points box, both editable:

- **The name is what appears in Canvas.** Fix it here rather than in Canvas afterwards, because
  deploying adds a rubric rather than replacing one, so a name corrected later means deleting the
  first one by hand.
- **Points start at the total you entered** and can differ per rubric.

Only the whole-assignment row starts ticked, so confirming without touching anything gives you
one rubric, exactly as before. Ticking more is a deliberate choice, and each one is its own
request — the list tells you how many and roughly how long.

**An assignment with no separate parts skips all of this** and goes straight to its single
rubric. Most assignments are one piece of work, and a one-row list with a foregone answer is not
worth stopping for.

### "How many rubrics?" is gone from the settings

That question is now answered after the description has been read instead of before, which is
the only point at which it can be answered. The setting also never worked: it asked the AI for
several rubrics through a form with room for exactly one, and what came back was a single thin
rubric. That is fixed by removing the question, not by patching it.

### Rubrics stopped collapsing into one criterion

A seven-part assignment could come back as a single criterion worth all 100 points, with neatly
short rating descriptions. The instruction to keep descriptions brief, added in v0.9.8, was being
read as "make the rubric smaller" rather than "make the sentences shorter".

The AI is now told explicitly that brevity applies to the wording inside a box and never to the
number of criteria. It is also told how to decide that number: cover what the assignment says it
is assessing — its learning outcomes, objectives, or list of required elements — and use four to
seven criteria when the description states none. A rubric with a single criterion holding the
whole total is refused outright, because it cannot show a student which part of the work cost
them the marks.

**A rubric read from your document or a screenshot is unaffected.** That is copied word for
word, as it always has been.

### Deploying from Part 1 sends all of them

If a run produced eight rubrics, the deploy button now says **Deploy All 8 Rubrics to Canvas**
and sends all eight. It used to send only the one on screen. Deploying a whole document was
already sending everything in it; this brings the other route into line.

### Saving gives you one document

Several rubrics save as a single Google Doc or .html file, each rubric its own table starting on
its own page — one thing to open, and one attachment to send an FD.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
