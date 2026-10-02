## What's new in v0.9.18

You can now choose **BoiseState.ai** instead of Gemini to do the AI work.

### Choose your AI under Initial Setup

The first setup card is now **AI Service**, with a choice between **BoiseState.ai** and
**Gemini**. Paste the key for whichever you pick. Your choice and both keys are remembered
separately, so you can switch back and forth without pasting again. Existing installs stay on
Gemini until you change it.

Get a BoiseState.ai key at [boisestate.ai/api-keys](https://boisestate.ai/api-keys). Keys expire
after 90 days; when the app says yours was rejected, make a new one.

### What works with BoiseState.ai, and what does not

Writing rubrics from a description, adjusting them, converting Word documents to Canvas CSV,
analysing a CSV and repairing one Canvas rejected all work.

Two things need Gemini, because BoiseState.ai's API has no way to receive a file or an image:

- **PDF rubric documents.** Use a Word document or a Google Doc instead.
- **The screenshot converter.** Its button is switched off while BoiseState.ai is selected.

### Things to know

- Every request counts toward your monthly BoiseState.ai allowance, and converting a document
  sends the whole document each time. Documents with several rubrics are converted two at a time
  rather than eight, because BoiseState.ai's answers are shorter.
- BoiseState.ai cannot be told to answer in a fixed format, so the app asks for one in the
  prompt and checks what comes back. If an answer is unreadable it asks once more before giving up.
