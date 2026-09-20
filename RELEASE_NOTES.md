## What's new in v0.9.9

### Deploying no longer scrolls the app away from you

This is the one worth installing for. While a deploy was running, the blue title bar and the
white ribbon beneath it were pushed off the top of the window, and there was no way to scroll
them back — no scrollbar, and the mouse wheel did nothing. What was left sat squashed into the
top of the screen with empty space below it.

It was the deployment log doing it. Every new line asked the browser to bring the newest entry
into view, and that request did not stop at the log box: it scrolled everything containing it,
including the whole window, until that line sat at the very top. A document of forty rubrics
asked for it about eighty times.

The log now scrolls itself and nothing else.

If you hit this, the control that suffered most was **text size**, which lives in that ribbon —
once the ribbon was off-screen there was no visible way to reach it. It is back where it belongs.
Ctrl + and Ctrl − work whether or not you can see it.

### The log stays where you put it

Scroll up in the deployment timeline to read why something failed and it now stays there. It
used to jump back to the newest line every time one arrived, which on a long run meant you could
not read anything that had already scrolled past. Scroll back to the bottom and it resumes
following on its own.

The panel can also be scrolled with the keyboard now — Tab to it, then the arrow keys.

### Rubrics can be saved to My Drive itself

The Drive folder picker would only let you choose a folder *inside* My Drive. My Drive itself
never appeared in its own list, so at the top level the **Choose** button simply sat there greyed
out with nothing explaining why, and every rubric had to go into a subfolder whether you wanted
one or not.

Open the **My Drive** tab and the button now reads **Choose My Drive**.

### Also

- "Several rubrics" is now "Multiple rubrics" in Part 1.

### Known limits, unchanged

- **"Multiple rubrics" still produces one rubric.** The setting does not work yet — a fix is in
  progress, and it will ask you to confirm which deliverables it found before writing anything.
- **The AI's suggested fix can be plausible and wrong.** It is checked for whether Canvas will
  accept it, not for whether it is what you meant.
- **Google sign-in asks you to sign in again about once a week.** A Google restriction on apps
  still in testing, not a bug.
- **Google shows a warning screen the first time you sign in.** Click **Advanced**, then **Go to
  Canvas Rubric Creator**.
