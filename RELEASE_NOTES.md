## What's new in v0.9.29

### "I updated the Rubrics manually in the Google Doc"

A new button on the document card, and the answer to a question worth stating plainly first:
**the Google Doc is a copy of your rubrics, not their source.** Canvas is sent what is in the
app. So a criterion you rewrote by hand in Google Docs was invisible to a deploy, and the app's
own version would replace it at the next save.

Press the new button and the app reads the document again and takes your edits as they now stand
— the rubrics on screen become what the document says, and deploying from there sends your
words. It reads the rubrics that are on screen, by name, one request each.

It sits on the document card whenever there is a Google Doc, because the app cannot tell a
document has been edited until it tries to write to one. When it *has* noticed — the amber
"this document has been changed" message added in v0.9.28 — the button turns blue, because at
that moment it is almost certainly what you want.

**The one thing it cannot follow is a rubric you renamed inside the document.** The name is how
each rubric is found, so a renamed one is reported rather than quietly skipped: rename it back,
or use **Edit existing draft rubrics** on the main screen to read the document from scratch.

The longer route still works and is still the one for anything bigger — a rubric added to the
document by hand, or a renamed one: **Edit existing draft rubrics**, tick what you want, and the
document is read fresh.


## What's new in v0.9.28

### Applying a change now saves it

Asking for a change and saving it were one intention split across two buttons. You would type
"add a criterion for APA formatting", press **Apply changes to 1 rubric**, watch the table
redraw — and the document in Drive still held the old version until you pressed a second button.

The run writes the document itself now. The summary says so: *Your Google Doc has been updated to
match. Same document, same link.* Google Docs keeps the version before it under **File → Version
history**, as it always has.

**Save changes to the Google Doc** stays, for the changes no AI run makes: renaming a rubric or
changing its points in the instant section. It is also the way back if the write fails — signed
out, offline, or a document moved to the bin, each of which is said plainly rather than left for
you to notice.

### Three reviews, and what they found

This release was read end to end by an accessibility review, a performance review and a security
review. The security review found no way to reach the Canvas token or the Google sign-in, and no
weakness in the way the app is sealed off from the web — but the other two found real faults, and
they are fixed here.

**Failures were being composed and then shown to nobody.** This screen had no place to display an
error at all: both of them lived in the half of the screen that draws *before* a rubric exists. So
a Google Doc that would not take a write, or a rubric the AI would not revise, looked exactly like
a success. The sentence is now shown where the work happened, and read aloud to a screen reader.

**Clearing the text you just loaded destroyed the box you were typing in.** Select-all and delete
inside *read them here* took the word count to zero, which unmounted the panel mid-keystroke —
with no way back but picking the file again. It stays open now however much you delete.

**The summary could name a rubric by its old title.** If you asked the AI to rename a rubric, the
confirmation named what it used to be called while the document correctly got the new name.

**Everything is faster.** Every call to the AI waited a flat two seconds before being sent, even
when the previous one had finished ten seconds earlier — the gap is now measured from the last
request rather than slept through unconditionally. And applying changes to several rubrics now
runs three at a time, the way drafting always has, backing off to one if Google asks for a slower
pace. Eight ticked rubrics: about a minute and a half before, about thirty-five seconds now.

**For keyboard and screen-reader users:** the save button no longer vanishes from the keyboard
when it switches off — it stays reachable and says why it is off; the tab strip says which tab is
selected instead of only colouring it; the checkboxes on the "which parts get a rubric" list have
names, so they are no longer eight identical "checkbox, checked"; focus no longer jumps to the top
of the window when a run finishes; and the Drive picker can be scrolled at 200% zoom, where its
Cancel and Choose file buttons used to be clipped off with no way to reach them.

**Contrast.** A disabled primary button was white text on light grey — 1.47:1, which is no text at
all. Disabled buttons app-wide are now 6.08:1. The unselected halves of Ranges/Single had a
1.24:1 border, invisible against the card; the paste box had the same invisible edge and no label
beyond its placeholder. All fixed, with the measured figures recorded in the design system.

**One dead button, found by the security review:** "Canvas Docs" in Part 3 pointed at a host that
was not on the app's allowlist, so clicking it had silently done nothing. The test that was meant
to catch exactly that only checked links, not buttons; it checks both now.

### The tab you are on is the tab you used

Choosing an assignment description from Drive lit **From Local Drive** — the app switched tabs so
the extracted words could be shown in the paste box. The file had come from Drive, so the screen
was saying something untrue about where it was.

The tab stays where you left it. The file's name sits under the **Browse Google Drive** button as
it did, now with the count of words read beside it, and *read them here* opens the text in place
if you want to check or correct it before the run. The same fix applies to **Edit existing draft
rubrics**, which has the same two tabs.


## What's new in v0.9.27

### Saving to the Google Doc says which way it goes

**Update the Google Doc** was read as pulling the document's own edits back into the app. It does
the opposite: the rubrics in the app are written out to the document. It now reads **Save changes
to the Google Doc**, beside **Save to this computer** — two destinations, one verb, no way to read
either backwards.

Bringing a document's own edits *into* the app is a different route entirely: **Edit existing
draft rubrics**, on the opening screen.

**And it switches off when there is nothing to save.** Pressing it with no changes made used to
write an identical revision, move the timestamp in the document's name, and replace anything
typed into that document by hand — all for nothing. The app now records what it wrote and
compares, so the button is live only when the rubrics genuinely differ. A rename or a points
change counts, not just an AI run.

### The tick box you could not see

"Describe a change above, then tick this to send it" sat beside a checkbox drawn at 40% opacity
while it was disabled, which on a grey panel is invisible. The instruction pointed at nothing.
The box stays visible now; only the words beside it dim.


## What's new in v0.9.26

### One button for changing a rubric

Four controls did this job, in three places. **Adjust this rubric** renamed it instantly;
**Request Changes** sent the whole rubric to the AI for about ten seconds; **Replace this rubric
from a file** swapped it for a document; **Start over** discarded everything. The first two
looked identical and were not, and nothing on screen said which was which until you opened one.

There is now one button — **Change this rubric** — opening one panel with two sections, each
labelled with what it costs:

- **Instant · no AI** — rename it, or change its points. Every word stays exactly as written.
- **Asks the AI · about 10 seconds each** — ask for a change in your own words.

Cheapest first, because renaming a rubric through the AI is ten seconds and a chance of rewording
for something a text field does exactly.

**"Replace this rubric from a file" is gone.** It swapped one rubric for a document you had edited
by hand, and it was asked about three times without ever being understood. The route back is
**Edit existing draft rubrics** on the opening screen: open the document, tick the rubrics, and
the hand-edited one comes in with the rest.

**Start over** keeps its own button. It does not change a rubric; it discards all of them.

### Updating a Google Doc just updates it

The app used to stop and ask before writing over a document that had been edited in Google Docs,
offering three buttons. Update now updates, with one line beside the button saying where the
previous version went:

> Updating replaces what is in the document. Google Docs keeps the previous version under File →
> Version history.

A document in your bin or deleted outright still says so, because nothing can be written to it
and a new document is the only move left.

*(The button itself was renamed in v0.9.27, above — it reads "Save changes to the Google Doc"
now, because "Update" was being read as pulling the document's edits back into the app.)*

### What gets sent to Canvas, said out loud

A tester assumed that deploying sends whatever is currently in the Google Doc. It does not — the
rubrics in the app are what becomes the CSV, and the document is a copy of them rather than the
source. The deploy card now says so, and says what to do about it: anything typed into the
document by hand needs to come back through **Edit existing draft rubrics** first.

### Smaller things

- **The finished message** reads "Rubric upload complete. Would you like to return to this app's
  main screen?" — the old one said "Deployment attempt complete", which sounds like it might not
  have worked.
- **The deployment log says how long it took:** "8 rubrics successfully uploaded in 3 seconds."
  Failures get their own sentence rather than a trailing clause, so a bad run cannot be skimmed
  past.
- **Green text on green panels is darker.** It measured 4.79:1 against a 4.5:1 requirement —
  passing by a margin this app's own rules reject elsewhere. It is 6.81:1 now.

## What's new in v0.9.25

### A fourth card: edit rubrics you already have

The opening screen had no door for the most ordinary job of all — changing a rubric that already
exists. You could only get there by drafting something new, or by finding **Upload Replacement
Rubric to App**, a button buried inside the review screen that handled one rubric at a time and
read as though it uploaded something to a Google Doc. (It never did. It read a file from your
computer and replaced the rubric on screen. It is now called **Replace this rubric from a file**,
which says the direction, the scope and the source.)

**Edit existing draft rubrics** takes a document from this computer or from Google Drive, lists
the rubrics it finds, and reads only the ones you tick:

> There are 39 rubrics in this document
> Tick the ones you want to change. Each is read separately, so taking only what you need keeps
> the run short — a document of forty rubrics costs two requests if you tick two.

Nothing starts ticked. Each rubric is its own request, and the document that makes this feature
worth having is the long one where two rubrics need a wording change. "Toggle all" is one click
away when the whole set really is wanted.

From there it is the screen you already know: the rubric table, Request Changes, the document
card, Deploy to Canvas. The rubrics come in exactly as written — the app reads them, it does not
redraft them — so your points and your wording survive the trip.

**A rubric document opened from Google Drive is updated in place.** The same file, under the same
link. If you have edited that document in Google Docs since opening it here, the app says so and
asks before overwriting. A document from this computer, or a .docx or PDF in Drive, is saved as a
new file instead: those cannot take a Google Doc's contents written back over them in any form
worth having.

**Every document the app writes to carries the time it was last written**, including yours. A
document called *Course Rubrics FINAL* comes back as *Course Rubrics FINAL (2026-10-16 6.30pm)*,
and on the next edit that time moves rather than a second stamp being added. The name under the
stamp stays as you wrote it — only documents the app created itself are named after their
rubrics. The alternative was leaving your name untouched, which meant a document rewritten at half
past two going on claiming eleven o'clock in its own title.

**The cards are now in the order a rubric lives in:** draft one from a description, draft one from
a screenshot, edit ones you have, send them to Canvas. The Canvas card is last because it is the
only one that leaves the app, and it now reads **Upload your existing draft rubrics to Canvas**.

### Two icons

The Canvas tile was two concentric circles with a filled middle, which at that size is a record
button. It is now Canvas's own mark, drawn the same way Canvas Extractor Tools draws it, in the
same red — the two apps are open on the same screen on the same day, so the same thing should
look the same in both.

The new edit card is the only route that starts and ends at the same kind of thing, so its second
rubric tile carries a star.

### Worth knowing before you edit someone else's rubric

**Four rating levels, always.** This app's rubrics have exactly four — Exemplary, Proficient,
Developing, Unsatisfactory — and that is what a rubric read out of a document becomes. Your
criteria, your wording and your points come across untouched, but a rubric with three levels or
five is fitted to four, and level names of your own ("Excellent", "Needs work") are replaced by
the four above. If a rubric's levels matter more than its criteria, check it on screen before
deploying.

**If the document is not a rubric document,** the app says so rather than inventing one: the first
pass looks for tables with criteria, ratings and points, and reports that it found nothing where
there is nothing to find. The list of names it shows you is the checkpoint — if those names are
not your rubrics, press Back rather than ticking them.

### The first rating no longer lands in the Criterion Description

An eCampus course developer deployed several rubrics to a sandbox and found that every criterion
arrived in Canvas with its top rating's words repeated in the **Criterion Description** field —
the same sentence twice, once as the description and once as the highest band, to be deleted by
hand on every criterion of every rubric.

The conversion was doing as it was told. The instructions named the Criteria Description column
and never said what to do when the source rubric has no description of its own — which is most of
them, because the criterion name and the rating bands are the whole table. Faced with an empty
cell and no guidance, the AI filled it with the nearest plausible text, which is the band directly
beside it.

Two changes, because a prompt is a request: the instructions now say to leave that cell empty
unless the criterion really has a description of its own, and the app itself drops a criterion
description that turns out to be a copy of the top rating, whatever wrote the CSV. That second
check also covers a repaired CSV, a hand-built one, and a Google Sheet a colleague edited.

**Rubrics already in Canvas are not fixed by this.** Once a rubric is deployed it belongs to
Canvas, and this app can only add rubrics, never edit one it sent earlier — redeploying creates a
second copy rather than correcting the first. For rubrics already in a course there are two
routes: delete the stray description by hand in Canvas, or delete the rubric there and deploy it
again from this version. With more than two or three rubrics the second is less work.

### Half-points are gone

Asked to make a 100-point rubric worth 50, the AI halved every number and handed back criteria
worth 10.5 and 17.5. Canvas accepts decimals without complaint, so nothing stopped it, but nobody
writes a ten-and-a-half-point criterion on purpose.

The app no longer produces a fractional point of its own accord. Your total is held exactly where
you asked for it and the criteria underneath it are rounded, with the leftover point going to
whichever criterion was cut hardest — so 2 / 10.5 / 17.5 / 10 / 10 becomes 2 / 10 / 18 / 10 / 10,
still 50 points. The rating bands are rounded too, not just the criterion totals.

**If you ask for a decimal, you get a decimal.** "Make each one worth 4.5" is a number you chose,
and the app stands aside. Rubrics read in from a document or a screenshot are never touched
either: those numbers are yours, not the AI's.

This narrows something the v0.9.22 notes said — that a request mentioning points made the app
stand aside completely. Your totals still stand exactly as asked. What the model does underneath
them is now tidied.

### The document card has moved to where the document is used

The card naming your Google Doc sat above the rubric table, while every action on that document —
updating it, replacing it, saving a copy — happened further down the screen, after the rubrics had
been read and changed. It is now the last thing in the review area, directly above Deploy to
Canvas.

**It is also one card instead of three.** A box naming the document, an amber warning when that
document had been edited by hand, and a green box reporting a change run were three separate
panels about one file, stacking on top of each other, with three of their five buttons doing the
same two things. They are now a single card that changes with the situation: green when a run has
just finished, amber when the document has been edited since the app wrote it, and plain when
there is simply a document to open.

**Open in Google Docs and Save to this computer have moved into it.** That leaves three buttons in
the row above — Upload Replacement, Request Changes and Start over — which are the three that
change the rubrics themselves. Five buttons in that row had squeezed every label onto three
cramped lines.

### Saved documents say they are rubrics

A document written from "Part 1: Systems Analysis" was filed in Drive under exactly that name,
which is indistinguishable from the assignment description it was written from — very likely
sitting in the same folder. It is now **Part 1: Systems Analysis Rubric (2026-10-15 11.00am)**,
and "Rubrics" where the document holds several. A title that already ends in "Rubric" is left
alone.

A document holding several rubrics now also names itself on its first page, as a heading above the
first rubric, with each rubric a heading beneath it. The Google Docs outline sidebar shows the
set's name and every rubric in it.

### The opening cards close again

Each card's button opened its route and nothing put it away. Pressing the same button again now
folds the route back up and returns you to the three cards — the same behaviour Request Changes
and Start over already had.

**Nothing is discarded by closing.** A half-written description, a chosen file and your settings
are all still there when you open it again. The quieter "or save to this computer instead" link
never closes anything; it only changes where the result is headed.

## What's new in v0.9.24

*Four faults found by review before release, all fixed below — the detail is at the end of this
section.*

### A new opening screen

The app used to open by asking **"Do you already have a draft rubric document ready to deploy?"**
— which meant classifying yourself, in the app's own vocabulary, before it had shown you anything
it could do. Answering wrongly was invisible, because both branches look like the whole app.

Three cards now state the three things the app does:

- **Draft rubrics from an assignment description**
- **Draft a rubric from a screenshot**
- **Send draft rubrics you already have to Canvas**

Each shows what goes in and what comes out as a pair of icons. The blue rubric grid is the output
of the first two cards and the input of the third, so the three together say how the app fits
together before anything is clicked.

**Every card offers a way through without Google.** "or save to this computer instead (.html)" on
the first two, "or just save the CSV files to this computer" on the third. Taking that route makes
the local save the main button for the rest of the run, instead of leaving you to find it. The
person most likely to need it is the one whose Google sign-in has just failed, and that is exactly
who is looking at this screen.

### "Choose the parts again" has moved, and says what it does

It sat at the bottom of **Adjust this rubric** — a panel headed "rename it or change its points"
that promises "Changes here are instant and keep every word as written. No AI involved." The link
underneath did the opposite: it discards every rubric and re-runs the AI over all of them. It also
acted on the whole set where everything else in that panel acts on one rubric.

It is now a button in the row with the other whole-set actions, reading **Start over from the
description**. The confirmation it shows is unchanged — that text was always explicit about what
is lost; the problem was that nothing before the click suggested you were near anything
destructive.

### Adding a criterion can no longer leave it worth nothing

v0.9.22 stopped an edit changing a rubric's total. A real run then found the other half of the
problem: asked for criteria covering APA formatting and grammar, the AI held the rubric at its 100
points by rewriting the existing three from 40/40/20 to 35/35/30 and giving **both new criteria 0
points**. The total never moved, so nothing noticed. Two criteria deployed to Canvas that render,
can be clicked, and cannot affect a grade.

Any criterion left worth nothing by an edit is now given an even share, with the others rescaled
to pay for it and the total held where it was. A criterion that was *already* worth nothing before
the edit is left alone — a zero-weighted row can be deliberate — and a request that mentions
points still overrides all of it.

### Two rubrics with the same name

Canvas does not enforce unique rubric names, so a document holding two rubrics called the same
thing deploys both and leaves the course with entries that can only be told apart by opening them.
One real 39-rubric document had two such pairs. The deploy card now says so before you send them.
It never blocks the deploy — duplicates are legal and sometimes intended.

### Smaller things

- **Signing in clears the sign-in error.** Being told to sign in, doing it, and finding the
  message still there — directly above a button that would now work — is fixed.
- **The sign-in message is one sentence:** "You need to go to Initial Setup and sign into Google
  first."
- **Google Drive errors no longer show their plumbing.** They arrived as *"Could not reload
  document: Error invoking remote method 'drive:fetchForProcessing': Error: …"* with the real
  sentence at the end. Every Drive call now strips that framing, as the AI calls always have.
- **The conversion log names what it is making:** "Converting 39 draft rubrics to CSV files in 5
  groups of up to 8."

### Found by review before release

Four problems in the work above, caught by a review pass rather than by use:

- **The zero-point fix could create a zero-point criterion.** Repaying the surviving criteria in
  proportion can round a small one away: 1/33/66 in a 100-point rubric, plus two new criteria,
  came out 0/20/40/20/20 — two criteria revived by killing a third. Every criterion is now given
  a point before anything is shared out, and where there are not enough points to go round the
  rubric is left alone instead. Checked against all 4,753 ways of splitting 100 across three
  criteria.
- **The three panels in Part 1 were not mutually exclusive.** The new "Start over from the
  description" closed the other two, but neither of them closed it — so its confirmation, with a
  destructive button in it, could sit open above an unrelated change request, and survived a run.
- **"Two rubrics share a name" said "Two" however many there were**, directly contradicting the
  figure beside it when three rubrics shared a title.
- **Two of the three "save to this computer" links led nowhere local.** The screenshot screen had
  no local-save button at all — the code for one existed and was never wired up — so the link
  promised exactly what that screen could not do, to exactly the person who needed it. It has the
  button now. The third card's link has been removed rather than fixed: its CSVs only exist after
  a conversion run, which needs a Canvas course URL first, so the offer was not true at the point
  it was made. That card's own file picker already has a Local tab.

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
