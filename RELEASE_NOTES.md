## What's new in v0.9.14

One real bug, one new place to put your CSVs, and two pieces of wording.

### Stop now stops

Pressing **Stop** while the app was reading an assignment description did not stop it — it went
ahead and wrote a rubric anyway. This is fixed. Stop leaves you back on the **Create Draft
Rubric** card with your document still in the queue, your settings untouched, and nothing
written.

The same fault was in two other places, where pressing Stop partway through a batch of rubrics
was ignored and the run carried on to the end. Those are fixed too, so Stop is now honoured
everywhere it appears in Phase 1 — during the analysis, during generation, and during a round of
requested changes.

### Your CSVs can go to Google Drive

After a deployment, the offer of CSV copies now has two destinations: **Save to my computer** as
before, and **Add to Drive**, which puts one Google Sheet per rubric into a folder you pick.
This is the same thing Part 2's **Add All to Drive** does, so both screens now put the same kind
of file in your Drive.

The offer also stops closing itself. Saving used to replace it with a receipt, so if you saved to
your computer and then wanted a copy in Drive as well, there was no way back to it short of
running the deployment again. Only **No thanks** dismisses it now, and the receipt tells you
where each copy went.

If you are signed out, **Add to Drive** is greyed out with a line saying why, and saving to your
computer still needs no Google account at all.

Two smaller fixes came with it: the receipt only appears when a file actually landed — backing
out of the save dialog used to leave "CSVs downloaded" on the screen — and a single rubric saves
as one `.csv` while several save as a zip, as before.

### "Draft 8 rubrics", not "Create 8 rubrics"

The button at the bottom of the deliverables checklist now says **Draft**. What comes back from
it is a first pass, and the entire screen after it is built around revising that first pass.
Create promised something finished.

### The tick box asks you to confirm

It said **Tick this box to turn on the deploy button**, which described the machinery rather than
what you are agreeing to. It now says **Tick this box when you are ready to proceed**, and
**Ready to proceed** once ticked. The line under it is unchanged: no further revision is needed,
and the rubrics are ready for Canvas.

### Known limits

- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
- **CSVs added to Drive arrive as Google Sheets.** To use one as a Canvas import again, open it
  and choose File → Download → Comma-separated values.
