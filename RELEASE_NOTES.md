## What's new in v0.9.10

### There is a Start Over button

You can now abandon a run and go back to the beginning without closing the app. It is in the
ribbon at the top, next to the text size control, and it is always there.

It was supposed to be there already. The button existed in the code but was shown only when a
flag was set, and nothing in the app ever set that flag — so it never appeared once, for anyone,
at any window size. The only way back to the start was the "would you like to start over?" card
that appears after a deployment finishes, which is no help at all if what you want is to abandon
a rubric halfway through. That flag has been removed rather than fixed, so nothing can hide the
button again.

Start Over clears the rubric, the CSV and anything in progress, and returns you to the first
screen. Your Gemini key, Canvas token, Google sign-in and the last course URL are all kept —
it starts the work over, not the setup. Rubrics already deployed to Canvas stay in Canvas.

If there is unsaved work, it asks first. If there is nothing to lose it just does it, because a
confirmation you always click through is not protecting anything.

### The top bar no longer runs off the edge

The row holding text size, Start Over and Help Center could not wrap, so at a narrow window its
controls ran off the right-hand side with no way to reach them. It now wraps onto a second line
instead.

### Known limits

- **"Multiple rubrics" still produces one rubric.** Being replaced by something better: the app
  will find the deliverables in your assignment description, show you the list, and let you
  choose which ones get a rubric and how many points each is worth.
- **A generated rubric can come back with too few criteria** — sometimes only one, holding all
  the points. Being worked on now. A rubric read from a document or screenshot is unaffected;
  that is copied as written.
- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
