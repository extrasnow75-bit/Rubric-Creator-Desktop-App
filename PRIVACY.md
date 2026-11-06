# Privacy Policy: Canvas Rubric Creator

_Last updated: November 6, 2026_

Canvas Rubric Creator is a desktop app. It runs on your own computer and helps you draft rubrics from an assignment description, convert them to files, and add them to a Canvas course you choose. This page explains what information the app uses and where it goes.

## The short version

- The app runs on your computer. It has no server of its own.
- The developer does not receive, see or store your documents, your rubrics, your Canvas content, or your sign-in details.
- The app does not use analytics, advertising or tracking.
- Text you ask the app to turn into a rubric is sent to Google's Gemini service, using your own Gemini key. See "Gemini" below.

## What the app uses, and why

**Your Canvas access token.** You paste a Canvas API token into the app so it can list your courses, check that a course exists, and add rubrics to the course you choose. The token is stored on your computer, encrypted with your operating system's secure storage (the Windows Credential Manager or the macOS Keychain). It is sent only to your Canvas site. You can remove it at any time with the "Remove Token" button in the app.

**Your Gemini API key and Gemini.** To draft or revise a rubric, the app sends what you provide (an assignment description, the text of a document you chose, a screenshot, or your edit instructions) to Google's Gemini API. The request uses your own Gemini API key, which is stored on your computer in the same encrypted way as your Canvas token. What Google does with these requests is covered by the terms that apply to your Gemini key. The developer does not see them.

**Your Google account (optional).** If you choose to sign in with Google, the app asks for these permissions:

- `drive.readonly`: to let you browse and search your Google Drive inside the app, and to read the documents you choose to convert into a rubric. The app only opens files you select.
- `drive.file`: to create files in your Google Drive (such as a rubric Google Doc) and to open or update only the files the app itself created.
- `openid`, `email` and `profile`: to show your name and email address in the app so you can see which account is signed in.

Your Google sign-in is stored on your computer, encrypted with your operating system's secure storage. You can sign out in the app at any time, and you can remove the app's access in your Google Account settings under "Third-party apps & services". The app also works without Google sign-in: files you pick from your computer and rubrics you save locally never touch Google Drive.

**Information kept on your computer.** The app keeps your settings and a short list of recently used files and rubrics on your computer so it can offer them again. This information is not sent anywhere.

**Checking for updates.** The app asks GitHub for the version number of the latest release, so it can tell you when a newer version is available. This is an ordinary web request to GitHub. No information about you, your documents or your courses is included.

## What the app does not do

- It does not send your documents, rubrics, Canvas content or sign-in details to the developer.
- It does not read any Google Drive file you have not chosen, and it does not change or delete any file other than the ones it created.
- It does not change anything in Canvas other than adding the rubrics you tell it to add.
- It does not sell or share information, and it does not show advertising.

## Google API Services User Data Policy

The app's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Information from your Google Drive is used only to provide the features you ask for (browsing, converting a document you chose, and saving files). It is not used for advertising, and it is not transferred to anyone else except the Gemini request described above, which happens only when you ask the app to draft or revise a rubric.

## How long information is kept

The app keeps your sign-in details and settings on your computer until you sign out, remove the token or key, or uninstall the app. Files the app creates in your Google Drive, in Canvas or on your computer belong to you and stay until you delete them.

## Changes to this policy

If this policy changes, the updated version will be posted at this address with a new date at the top.

## Contact

Questions about this policy: please open an issue at https://github.com/extrasnow75-bit/Rubric-Creator-Desktop-App/issues
