## What's new in v0.9.17

A layout release. Phase 1's review screen now has a heading, deploying is a card of its own, and
the Adjust panel stays out of the way until you want it.

### The review area has a heading

Phase 1 is one card with two states. Before anything is generated it is headed **Create Draft
Rubric**; afterwards it went straight into the list of rubrics with no heading at all. So the
largest text on the screen was one rubric's own title, which made a single rubric look like the
subject of the page rather than one of eight.

That half of the card is now headed **Review Your Draft Rubrics**, with a line underneath saying
what to do there. The rubric's title and the panel headings below it step down in size to match,
so the page reads in the order it is meant to.

### Deploying is a separate card

The confirmation tick box, the deploy button, the **Save CSV files** link and the Canvas course
box have moved out of the review card into their own card below it, headed **Deploy to Canvas**.

They used to sit at the bottom of the review card, so the last thing inside "is this rubric
right?" was "send it to Canvas". Two cards put the break where the decision is.

### Adjust this rubric opens when you ask

The **Adjust this rubric** panel used to be open all the time, putting two text fields between the
save buttons and the deploy button on every visit. It is now a single line you click to open —
**Adjust this rubric — rename it or change its points** — and everything inside it works exactly
as before.

### Request Changes shows that it is open

**Request Changes** and **Upload Replacement Rubric to App** now look pressed while their card is
showing, and clicking either one again closes it. Previously the only way to close those cards
was the small × in the corner, and nothing marked which button had opened them.

Note that the Request Changes card deliberately stays open when you move between rubrics — that
is what lets you write a request for several rubrics and apply them in one run.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
- **CSVs added to Drive arrive as Google Sheets.** To use one as a Canvas import again, open it
  and choose File → Download → Comma-separated values.
- **Rescaling rounds to whole points.** A criterion worth 15 in a 75-point rubric becomes 8 in a
  40-point one, not 8.5.
- **Editing a rubric after deploying does not change it in Canvas.** Deploying again adds a second
  copy; delete the old one in Canvas if you redeploy.
