# Schedule Bot

A Google Apps Script that posts to Slack (and/or email) from the team Google Calendar. It sends:

- **A weekly schedule** every Monday morning: the next 7 days of events with location and notes, plus an **Upcoming** section listing upcoming competitions and save-the-dates and which reminders go out that week.
- **A monthly "at a glance" summary** on the 1st of each month, **January–May** (peak competition season). It gives a very brief list of competition dates, save-the-dates and practice days.
- **Competition reminders** (`[COMP]` events) 2 weeks, 1 week, 3 days, 2 days, 24 hours and 12 hours before.
- **Save-the-date reminders** (`[SAVE THE DATE]` events) once a week for the 8 weeks before.
- **Holiday reminders** (`[HOLIDAY]` events) once a week for the 3 weeks before.
- **Drive reminders** (`[DRIVE]` events) 5 days, 3 days, 1 day and 12 hours before.
- **Reminders for untagged events** 2 weeks, 1 week, 3 days and 1 day before.
- **Deleted-event alerts** whenever an upcoming event is deleted from the calendar.

Every reminder and alert includes the event's **location and notes** (from the event description).

The code is in [`schedule_bot.gs`](schedule_bot.gs).

> **Never commit the real Slack webhook URL or calendar ID.** Anyone who has the webhook URL can post to the channel. Keep the placeholders in this repo and fill in the real values only in the Apps Script editor.

---

## Why Apps Script (and not the monday ↔ Google Calendar integration)

The monday–Google Calendar integration only **syncs** monday items into Google Calendar as events. It doesn't summarize events or send messages. Apps Script runs free on Google's servers, reads the calendar directly and can post to Slack.

Other options we considered:

- **A monday workflow** (scheduled trigger → get items → code block → Slack). This is a good fit if the schedule lives on a monday board.
- **Zapier/Make.** This works, but the free tiers are limited and batching many events into one message is awkward.

---

## Setup

### 1. Create the Slack app and webhook

1. Go to <https://api.slack.com/apps>, click **Create New App** and choose **From a manifest**.
2. Pick the workspace, choose the **YAML** tab and paste this manifest:

   ```yaml
   display_information:
     name: Schedule Bot
     description: Posts the weekly team schedule from Google Calendar.
     background_color: "#1f3a93"
   features:
     bot_user: # required: Slack rejects bot scopes without a bot user
       display_name: Schedule Bot
       always_online: false
   oauth_config:
     scopes:
       bot:
         - incoming-webhook
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

3. Click **Install to Workspace**, pick the channel and click **Allow**. If the workspace restricts app installs, a Slack admin has to approve it first.
4. In the left sidebar, open **Incoming Webhooks** and copy the URL (`https://hooks.slack.com/services/...`).

Each webhook posts to **one channel only**. If the URL leaks, delete the webhook on the same page and add a new one.

### 2. Create the Apps Script project

1. Go to <https://script.google.com> and create a **New project**. Paste in `schedule_bot.gs`, replacing the starter code.
2. Fill in `CONFIG` at the top of the script:
   - `CALENDAR_ID`: in Google Calendar, open the calendar's ⋮ menu, choose **Settings and sharing** and copy the ID under **Integrate calendar**. The account running the script must be able to view this calendar.
   - `SLACK_WEBHOOK_URL`: the URL from step 1.
   - `EMAIL_TO` (optional): an address to also send email to.
3. **Save** the project.

No extra Apps Script services are needed. Don't add the Google Calendar API service.

**You don't need to deploy anything.** Deployments are for web apps, add-ons, APIs and libraries. Triggers run from the saved project, and saved edits take effect on the next run.

### 3. Preview, authorize and test

Run these from the function dropdown. **None of them send anything.** Check the **Execution log** for their output.

| Function                | What it shows                                                         |
| ----------------------- | --------------------------------------------------------------------- |
| `previewWeeklySchedule` | The Monday message as it would look right now                         |
| `previewMonthlySummary` | The "at a glance" summary for the next January–May month              |
| `previewReminders`      | Every reminder for tagged events in the next 60 days, with send times |
| `debugTagMatching`      | Every event in the next 90 days and which tag (if any) it matched     |

The first run asks for permissions. If Google says "Google hasn't verified this app", click **Advanced** and then **Go to (project name)**. This is normal for your own scripts.

To send a real test message to Slack, run `sendWeeklySchedule`.

### 4. Schedule it

Run `createTriggers` **once**. It sets up:

| Function             | When it runs                                                                          |
| -------------------- | ------------------------------------------------------------------------------------- |
| `sendWeeklySchedule` | Mondays, 7–8am Eastern (Google only guarantees the hour)                              |
| `sendMonthlySummary` | The 1st of every month, 7–8am. It only sends in the months listed in `MONTHLY.MONTHS` |
| `checkReminders`     | Every hour                                                                            |
| `checkDeletedEvents` | Whenever the calendar changes, plus every hour as a backup                            |

Running it again replaces the old triggers, so you won't get duplicates. To confirm it worked, open **Triggers** (the clock icon) in the left sidebar.

---

## Tagging events

Put the tag anywhere in the event title. Square brackets are required, and upper or lower case both work. The tag is removed from the messages.

| Tag               | Example title                       | Reminders                                                  |
| ----------------- | ----------------------------------- | ---------------------------------------------------------- |
| `[COMP]`          | `[COMP] NE District – Hartford`     | 2 weeks, 1 week, 3 days, 2 days, 24 hours, 12 hours before |
| `[DRIVE]`         | `[DRIVE] Drive practice at the gym` | 5 days, 3 days, 1 day, 12 hours before                     |
| `[SAVE THE DATE]` | `[SAVE THE DATE] Awards Banquet`    | Weekly, from 8 weeks out to 1 week out                     |
| `[HOLIDAY]`       | `[HOLIDAY] Thanksgiving Break`      | Weekly, from 3 weeks out to 1 week out                     |
| _(no tag)_        | `Build session`                     | 2 weeks, 1 week, 3 days, 1 day before                      |

If an event has more than one tag, the first one in this order wins: `[COMP]`, `[DRIVE]`, `[SAVE THE DATE]`, `[HOLIDAY]`.

**Repeating untagged events get reminders too.** A practice every Tuesday and Thursday gets 4 reminders per occurrence. To turn reminders off for repeating untagged events, set `UNTAGGED.skipRecurring: true`. Untagged reminder messages are in `UNTAGGED.reminders`.

## Customizing messages

Edit `REMINDER_TYPES`. Each type has a `tag`, a `label` and a list of reminders, and each reminder has an offset in hours and a message:

```javascript
{ hours: 24, message: '*{name}* is tomorrow: {date}, {time}.' }
```

| Placeholder   | Becomes                              |
| ------------- | ------------------------------------ |
| `{name}`      | Event title (without the tag)        |
| `{date}`      | e.g. `Saturday, Mar 14`              |
| `{time}`      | Start time, or `all day`             |
| `{countdown}` | e.g. `3 weeks`, `2 days`, `12 hours` |
| `{location}`  | Event location, or `TBD`             |
| `{notes}`     | Event description                    |

**Location and notes are added automatically** to the end of every reminder, so you don't need `{location}` or `{notes}` in the message. Notes over `CONFIG.NOTES_MAX_CHARS` (300) characters are cut off.

Slack formatting works: `*bold*`, `_italic_`, and `<!channel>` to ping everyone.

To add another tag type (e.g. `[OUTREACH]`), copy one of the blocks in `REMINDER_TYPES` and change the tag, label and reminders.

## Monthly summary (January–May)

On the 1st of each month in `MONTHLY.MONTHS`, the script posts a short overview of that month:

```
March 2027 at a glance
Competitions: NE District (Sat 3/14), Week 4 District (Sat 3/28)
Save the dates: Awards Banquet (Fri 3/20)
Holidays: Spring Break (Mon 3/30)
Practices (12 days): 3/2, 3/4, 3/6, ...
+5 other events. Details in the weekly updates.
```

How it sorts events:

- Each event goes in the first category in `MONTHLY.CATEGORIES` whose `match` text appears in its title (any capitalization).
- `list: 'names'` shows each event's name and date. `list: 'dates'` shows only the days, which keeps busy categories like practices short.
- Anything that doesn't match a category is counted as "other events."
- Practices are matched by the word **"practice"** in the title. Add more categories (e.g. `{ label: 'Build sessions', match: 'build', list: 'dates' }`) to fit how the team names events.

To change the season, edit `MONTHLY.MONTHS` (1 = January … 12 = December).

## How the timing works

- **Reminders** are checked every hour and each one is sent **once**, within about an hour after it's due. If you move an event in the calendar, the remaining reminders follow the new time.
- Reminders that were already past due when you set this up (or when an event was tagged) are **skipped**, not sent all at once.
- **All-day events** get their reminders at 8am (`CONFIG.ALL_DAY_REMINDER_HOUR`) instead of midnight. For example, "1 week out" goes out at 8am a week before.
- **Deleted-event alerts** cover events in the next `CONFIG.DELETE_WATCH_DAYS` (90) days.
  - They usually arrive within a minute or two of the deletion.
  - Deleting a recurring event sends **one** alert ("N upcoming occurrences"), not one per occurrence.
  - Events moved more than 90 days out don't trigger an alert.
  - There are no alerts for anything deleted before `createTriggers` was first run.
  - A deleted event's remaining reminders stop automatically, and the alert says how many were cancelled.

---

## Troubleshooting

| Symptom                                    | Likely cause                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `Calendar not found`                       | Wrong `CALENDAR_ID`, or your account can't see that calendar                                                           |
| Slack returns 403/404                      | The webhook URL was copied wrong or the webhook was deleted                                                            |
| "Nothing scheduled this week"              | It's working, but there are no events in the next 7 days                                                               |
| "No tagged events in the next 60 days"     | Tag missing or misspelled, the event is on a different calendar, or it's more than 60 days out. Run `debugTagMatching` |
| Debug shows "0 events"                     | The script can't see that calendar. Check sharing/permissions                                                          |
| An event shows `(no tag)` in debug         | Fix the title. The tag needs square brackets, e.g. `[COMP]`                                                            |
| No monthly summary arrived                 | It only sends in `MONTHLY.MONTHS` (Jan–May by default)                                                                 |
| Practices missing from the monthly summary | Their titles don't contain "practice". Change `match` or add a category                                                |
| Duplicate messages                         | Old triggers left over. Run `createTriggers` again, or delete extras under **Triggers**                                |
