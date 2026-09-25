## What's new in v0.9.18

The app now adds up a rubric's points itself instead of taking the AI's word for it.

### Rubrics that were not worth what they said

In a recent eight-part run, two rubrics came back worth three times what they claimed. Each one
gave *every* criterion the whole hundred-point budget — ranges running 100-85, 85-70, 70-50, 50-0
on every row — and then reported the rubric total as 100. The other rubrics in the same run split
their budget correctly, so nothing about the settings or the assignment caused it.

Nothing in the app noticed. The rubric screen and the Google Doc both printed the total the AI
wrote, so they agreed with each other and both disagreed with Canvas — which reads neither of
them. Canvas works out what a criterion is worth from its top rating, so those two rubrics would
have been created worth 300 points apiece while every number on screen said 100.

Totals are now calculated from the ratings, in the app and in the document. Where the calculated
total does not match what the rubric was drafted for, an amber notice appears above the rubric
saying both numbers and what Canvas would actually create, with two ways to settle it:

- **Make it 300 points** accepts the criteria as drafted and corrects the total line. Nothing
  moves; the rubric was already worth this.
- **Adjust this rubric** rescales every criterion to the total you meant, which is the choice to
  make if the rubric really should be worth 100.

Which of those is right depends on how you want the assignment weighted, so the app does not pick
one. Deploying is not blocked either — the points are real points Canvas accepts.

The deploy card also names any affected rubrics by title. Rubrics go to Canvas as a set, and a set
gets checked by opening the first one, so a problem on the fourth was easy to never see.

### Overlapping point ranges are corrected

Reading down a criterion, each rating should start where the one above it stopped: 40-32, 32-24,
24-12, 12-0. One criterion in the same run ran 20-16 for Exemplary and then 20-12 for Proficient,
so a score of 18 counted as both.

Canvas stores only the top of each range, so that criterion would have arrived with two tiers both
worth 20 — a grader clicking either one awards full marks, and the criterion's total looks right
the whole time. These are now lined up automatically when the rubric is drafted or changed, since
a rating's starting number has only one correct value. The wording is untouched, and the top
rating — the one that decides what the criterion is worth — never moves.

Rubrics read in from a screenshot or converted from a document are left exactly as they are. Those
are your numbers, not the AI's, and the app reports a problem there rather than rewriting them.

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
