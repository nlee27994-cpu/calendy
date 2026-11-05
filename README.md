# Calendy

A study planner for students who use Google Classroom. It runs as a Chrome extension in the browser's side panel, so it also works on Chromebooks.

- **Google Classroom:** pulls every class, assignment and due date, and knows what you've already turned in.
- **Organized downloads:** saves each assignment's files to `Downloads/Calendy/<Class>/<YYYY-MM-DD Assignment>/`. Google Docs and Slides are saved as PDF and Sheets as `.xlsx`. It **follows the links inside attached Google Sheets** and downloads those Drive files into `linked/`. Each folder also gets an `_assignment.html` with the instructions and every link.
- **Smart planning:** estimates how long each assignment takes (you can edit the estimates), then schedules study blocks:
  - earliest deadline first
  - big work spread over several days in 45-minute sessions, not one cram night
  - finishes 2 hours before the deadline
  - respects your study hours and a daily limit
- **Works around your calendar:** reads your Google Calendars and never schedules over existing events. It also leaves a gap before and after each one. It ignores events marked "Free", events you declined, and (optionally) all-day events.
- **Google Calendar:** one click adds the plan as 📚 events. Re-planning replaces Calendy's old blocks and never touches your own events.

## Try it without Google (demo mode)

```bash
npm run demo
```

Open <http://localhost:5173/sidepanel.html> and click **Try it with sample data**.

## Run the tests

```bash
npm test
```

## Set it up with your Google account

You need a free Google Cloud project, about 10 minutes, done once.

1. **Load the extension.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension/` folder. Copy the **ID** that Chrome shows for Calendy.
2. **Create a Google Cloud project** at <https://console.cloud.google.com>.
3. **Turn on the APIs.** Under *APIs & Services → Library*, enable **Google Classroom API**, **Google Drive API**, **Google Sheets API** and **Google Calendar API**.
4. **Set up the OAuth consent screen.** Under *APIs & Services → OAuth consent screen*, choose **External**, fill in the app name and your email, and add yourself under **Test users**. Use the email for the account your Classroom is on.
5. **Create a client ID.** Under *APIs & Services → Credentials → Create credentials → OAuth client ID*, choose application type **Chrome Extension** and paste the extension ID from step 1.
6. **Add it to the manifest.** Put the client ID into `extension/manifest.json` in place of `YOUR_CLIENT_ID.apps.googleusercontent.com`, then click **Reload** on `chrome://extensions`.
7. Click the Calendy toolbar icon and choose **Connect Google account**.

The extension ID depends on the folder's location on disk. If you move the folder, update the client ID in step 5.

### "Access blocked" when signing in?

Your school's Google Workspace admin controls which apps can connect to school accounts. For students marked as under 18, apps are blocked unless the school approves them. The error usually says `admin_policy_enforced`. Your options:

- Ask the school's IT to allow the app's client ID.
- Test with a personal Gmail account: create your own Classroom as a teacher with one account and join it as a student with another.

While the app is in "Testing" mode, only the test users you added can sign in, and Google shows an "unverified app" warning. To let anyone use it, you'd need to publish it and pass Google's verification. `drive.readonly` is a restricted scope, so that verification includes a security assessment.

## How it's organized

```
extension/
  manifest.json        Chrome extension config + Google scopes
  background.js        opens the side panel when the toolbar icon is clicked
  sidepanel.html/css/js  the UI (assignments, plan, settings)
  lib/
    scheduler.js       planning engine (pure, unit tested)
    assignments.js     Classroom courseWork -> tasks, time estimates
    links.js           Drive-link parsing, safe file and folder names
    google.js          sign-in (chrome.identity) + API fetch helper
    classroom.js       courses, assignments, turned-in status
    calendar.js        read events, write/remove study blocks
    drive.js           download/export Drive files, find links in Sheets
    downloader.js      builds the organized assignment folders
    demo.js            sample data for demo mode
    storage.js         settings persistence
tests/                 node --test unit tests
```

Everything runs in your browser and goes straight to Google's APIs. There's no server, and your data never leaves your computer except to talk to Google.

## Ideas for next steps

- A floating assistant bubble in the corner of web pages that opens the panel.
- AI study guides and step-by-step explanations for downloaded assignments.
- Spaced-repetition review sessions before tests.
- Automatic re-planning when you miss a session.
