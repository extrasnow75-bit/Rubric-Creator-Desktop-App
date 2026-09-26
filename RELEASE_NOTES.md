## What's new in v0.9.19

This includes everything from v0.9.18, which was only ever built for testing and never released.

### Rubrics that were not worth what they said

In one eight-part run, two rubrics came back worth three times what they claimed. Each gave
*every* criterion the whole hundred-point budget — ranges running 100-85, 85-70, 70-50, 50-0 on
every row — and then reported the rubric total as 100. Other rubrics in the same run split their
budget correctly, so nothing about the settings caused it.

Nothing in the app noticed. Canvas works out what a criterion is worth from its top rating, so
those rubrics would have been created worth 300 points each while every number on screen said 100.

Totals are now calculated from the ratings, on screen and in the Google Doc, so what you see is
what Canvas will build. Where that does not match what you asked for, a notice above the rubric
says so in those words — **"This rubric is worth 300 points, not the 100 you asked for. Each of
its 3 criteria was given the full 100 points instead of a share of them."** — and offers three
ways to settle it:

- **Split 100 points by importance** asks the AI to weight the criteria, and only the numbers.
  Not one word of the rubric is rewritten.
- **Divide 100 evenly** does it instantly without asking anything, and shows what the result
  would be before you choose it.
- **Keep it at 300** accepts the rubric as drafted and corrects the total line.

The first is usually the one you want. When every criterion has been given the whole budget there
is no weighting left to preserve, so dividing the points can only ever produce an even split —
asking for a weighting is the only way to get something like 50/25/25 back.

Deploying is never blocked; these are real points Canvas accepts. The deploy card names any
affected rubric with both its figures, since rubrics go to Canvas as a set and a set gets checked
by opening the first one.

The instruction given to the AI has been tightened too, so this should happen less often.

### Overlapping point ranges are corrected

Reading down a criterion, each rating should start where the one above it stopped: 40-32, 32-24,
24-12, 12-0. One criterion in the same run ran 20-16 for Exemplary and then 20-12 for Proficient,
so a score of 18 counted as both.

Canvas stores only the top of each range, so that criterion would have arrived with two tiers both
worth 20 — a grader clicking either one awards full marks, and the criterion's total looks correct
throughout. These are now lined up automatically, since a rating's starting number has only one
correct value. Wording is untouched, and the top rating never moves.

Rubrics read in from a screenshot or converted from a document are left exactly as they are. Those
are your numbers, not the AI's, so the app reports a problem there rather than rewriting them.

### The Total points box

No more up and down arrows. They were a small target sitting where the cursor goes, and with the
pointer over the box the scroll wheel quietly changed the number while you scrolled the page.

The box also used to refuse to be empty: clearing it to type a new figure put 100 straight back
before the first digit landed, so the only way to reach 75 was to overtype in the right order.
It now stays empty while you type, and falls back to your last figure only if you leave it blank.

### One tickbox for change requests

There was a tickbox per rubric, which meant writing a request and forgetting to tick it left that
rubric silently unchanged. There is now one tickbox for the whole run, and it lists every rubric
the run will cover.

### Knowing when the changes are done

Finishing a run used to change one word in the green box below the table — which is a long way
from the button you pressed, and read the same whether one rubric had changed or eight.

A summary now appears where the button is, naming the rubrics that changed, and the rubric buttons
at the top carry a green dot on the ones that came back different so you know which to check.

### One Google Doc that stays current

**Open in Google Docs** used to create a brand new document every time. Three revisions left three
identically named documents in your Drive, and nothing said which was the latest.

Once a document exists, the button becomes **Update the Google Doc** and writes back to the same
file. The link never changes, Drive stops filling with copies, and Google Docs' own **File →
Version history** becomes a real record of each revision.

A card on screen now shows the document's name with **Open** and **Copy link**, so you are not
relying on having spotted the browser tab — useful when it opens behind the app or on another
screen. **Create a new one instead** is there when you do want a separate copy.

If you have edited the document by hand in Google Docs, the app notices and asks before
overwriting it. If you have deleted it, the app says so and offers a new one.

Documents are now named with the time they were written — *Wicked Problems and Ethical Solutions
Through Social Change Theory (2026-09-25 6.25pm)*. The date is year-first so Drive sorts your
versions in order, and the time uses a full stop because Windows will not accept a colon in a
filename. Files saved to your computer are named the same way. The stamp is only ever in the name,
never inside the document, so it cannot affect converting a rubric to CSV or pushing it to Canvas.

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
