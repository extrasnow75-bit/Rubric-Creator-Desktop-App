## What's new in v0.9.23

### Rubrics are drafted three at a time

An eight-part assignment made nine separate requests to Gemini, each waiting for the one before
it — which is where four minutes went. Nothing required that: the rubrics do not depend on each
other, and the only reason for the queue was the free tier's rate limit.

Three are now written at once. An eight-part document that took around four minutes should take
closer to a minute and a half.

**If Google pushes back, it drops to one at a time and says so.** The app already knows the moment
a request starts waiting on a busy service or a rate limit — that is the amber line added in
v0.9.21 — and one of those is enough to finish the run one rubric at a time:

> Google's AI service is busy, so the rest of the rubrics are being written one at a time. This is
> slower but far more likely to finish.

The notice stays on screen after the run, because "why did that take so long" is a question asked
afterwards rather than during. The pace never speeds back up mid-run: whatever made Google push
back is rarely over in thirty seconds, and a speed that oscillates would be worse than the slow one.

## What's new in v0.9.22

### Adding a criterion no longer makes the rubric worth more

Ask for "a criterion for grammar and APA 7 formatting" and the AI would add the row at the same
weight as the ones beside it — so a rubric you had set at 500 points came back worth 600, and
deployed to Canvas twenty per cent heavier than the assignment it grades. The edit was not wrong:
the request said nothing about points, so nothing told the model to take any away from anywhere.
Nothing in the app noticed either.

The rule now: **if your request does not mention points, the total does not move.** Adding a
criterion divides the same budget further; removing one gives its share back to the rest. Your
500-point rubric stays a 500-point rubric however many criteria it ends up with.

If your request *does* mention points — "add a grammar criterion worth 50", "make the first one
40", "reweight these", "split it 50/50" — the app stands aside completely and the new totals
stand, because you have said what you want.

### The "update your document" prompt now has the button in it

After a change run, the green box said your Google Doc still held the previous rubrics and to
*"use Update the Google Doc above"* — and that button was a card and a scroll away. Telling
someone what to do next and then making them go and find it is most of a usability problem on its
own, and the nearest document control does something different: it creates a second document
rather than updating the first.

**Update the Google Doc** and **Create a new one instead** now sit inside that green box, directly
under the sentence asking for them. They are the same two actions as the document card above, not
a second way of doing it.

## What's new in v0.9.21

### Every failure now says whose problem it is

When a run failed, the natural response was to start replacing things — a new Gemini key, then a
new key in a different Google account, then a look at the Canvas token. None of that touches a
busy Google server, and each attempt costs real time and leaves the setup worse than it started.

So every AI failure the app recognises now names the owner of the problem *and rules out the
wrong fixes by name*:

- **Google's AI service is busy** — at Google's end. Your Gemini key, your Google account, your
  Canvas token and your assignment description are all fine, and **a new key, in this Google
  account or any other, will not help**, because every key reaches the same busy service. It
  usually clears within a few minutes.
- **The key has used up today's free requests** — the key itself is fine; replacing it does not
  give you more. The allowance resets tomorrow.
- **Requests are going out too fast** — nothing is wrong with the key, your Google account or your
  Canvas token. A minute usually clears it.
- **The key was rejected** — this one *is* the key specifically, and not your Google sign-in, your
  Canvas token, or Boise State's Canvas. Check it on the Dashboard.
- **The model is no longer offered** — the app's problem, not yours. A new key will not fix it.

Anything the app does not recognise shows Google's own words untouched, with no claim about whose
fault it is. A confident guess would be worse than none.

### You can see it retrying now

The app already retried a busy service, but said nothing while it did. From the outside, "retrying,
four attempts to go" and "stopped dead" looked identical — the only difference being that the
working one took longer, which reads as the worse of the two.

While it waits, the progress bar now says so in amber: **"Google's AI service is busy — waiting
20s, then trying again (attempt 3 of 5). Nothing is wrong with your key or your account."** It
clears the moment the call finishes, either way.

### The time estimate was fiction

It divided the time so far by how far along the run was — but "how far along" only updated when an
item *finished*. So all the way through an item, the fraction sat still while the clock kept
running, and the estimate climbed the whole time. One run showed **20 minutes** two and a half
minutes in, on a document that had barely started; the same run half an hour earlier would have
claimed 40.

It now measures how long the finished items actually took and projects from that, so the figure
only moves when something real completes. Where nothing has finished yet there is no basis for an
estimate, so none is shown and the elapsed clock stands on its own.

## What's new in v0.9.20

### When Google's AI is busy, the app now says so — and waits it out

An eight-rubric run failed on every rubric and reported *"Could not generate … Try again, or
shorten the description."* The description was never the problem. Gemini had answered every
attempt with a plain statement of what was wrong — **"This model is currently experiencing high
demand. Spikes in demand are usually temporary"** — and the app threw that away, kept only the
fact that something failed, and printed advice that sent the user off editing a description and
then off replacing an API key. Neither would have helped.

Two faults behind it, both fixed.

**The reason was discarded.** Part 1 caught each failure, noted which rubric it belonged to, and
dropped the error itself. Whatever Gemini said never reached the screen. It does now, and it
leads the message rather than trailing it, because the reason is the part you can act on. Five
failures the app recognises are put into plain words:

- **Google's AI service is busy** — at Google's end, not your key, your description, or this app
- **The key has used up today's free requests** — it resets tomorrow; the key is fine
- **Requests are going out too fast** — a minute usually clears it
- **The key was rejected** — check it on the Dashboard
- **The model is no longer offered** — a fix in the app, not something you can change

Anything else shows Google's own words, untouched. The app never invents a reason it does not
have.

**A busy model was never retried.** The retry logic recognised one kind of temporary failure —
being asked to slow down — and treated everything else as fatal. A busy server, which is the most
temporary failure of the lot and the one Google itself describes as usually passing, fell through
and killed the request on its first attempt. It is now retried five times, starting at five
seconds and doubling. Most runs that used to fail outright will simply take slightly longer.

Being asked to slow down still waits a full minute between attempts, as before. Nothing waits out
a key that is out of requests for the day, or a key the service will not accept — waiting cannot
fix either.

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
