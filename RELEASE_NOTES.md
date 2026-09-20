## What's new in v0.9.16

You can now rename a rubric and change what it is worth without waiting on the AI, and go back to
the list of parts to draft a different set.

### Adjust a rubric without asking the AI

There is an **Adjust this rubric** panel under the save buttons in Phase 1. It does two things,
both instantly, and neither touches a word you or the AI wrote:

- **Rubric name.** Type a new one and press Enter or click away. This is the name Canvas shows and
  the name the CSV file takes.
- **Total points.** Type a number and press **Rescale**. Every criterion keeps its share of the
  total and its wording; only the numbers move.

Until now both of these meant using **Request Changes**, which sends the whole rubric back to the
AI and takes about ten seconds — to change a name, or do arithmetic. It also meant trusting the AI
to change only the thing you asked about, which is not something it guarantees.

Request Changes is still there, and is still the right tool when you want different criteria or
different wording.

### How rescaling divides the points

A rubric worth 75 across five criteria of 15, rescaled to 100, gives five criteria of 20. When it
does not divide evenly, the leftover points go to whichever criteria lost the most in the
rounding, so the total always lands exactly on the number you asked for rather than a point or
two under.

Ranges are kept as ranges. A rubric written as `25-20` stays in that form, and one written in
Canvas's own `4 to >3 pts` notation stays in that one.

### Choose the parts again

At the bottom of the Adjust panel, **Choose the parts again and re-draft** brings back the
checklist of assignment parts — with your names, your point values and your tick boxes exactly as
you left them. Change what you like and draft again.

This one does re-run the AI and **replaces every rubric on screen**, including any changes you
have applied, so it asks you to confirm first and suggests saving your CSVs before you go ahead.
Your rubrics stay visible underneath while you choose.

### A warning once you have deployed

Once you have sent rubrics to Canvas, the Adjust panel says so. Editing here does not change a
rubric that is already in your course, and deploying a second time **adds another copy rather
than replacing the first** — Canvas has no way for the app to update an existing rubric. If you
redeploy after an edit, delete the old one in Canvas.

### Smaller changes

- Ticking **ready to proceed** and then adjusting a rubric now un-ticks it, the same as uploading
  a replacement or applying a change request does. The tick says no further revision is needed,
  and a rename is a revision.
- The Help Center link is now labelled **Canvas Rubric Creator App — KB Article**.

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
