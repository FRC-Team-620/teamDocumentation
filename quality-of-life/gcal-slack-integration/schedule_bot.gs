// read the README first--add this to Google AppsScript (i.e. this is why we have a .gs file)
// =====================================================================
//  Schedule Bot: weekly schedule, event reminders and deletion alerts
//  No extra Apps Script services needed.
// =====================================================================

// ===================== Settings =====================
const CONFIG = {
  CALENDAR_ID: "your-team-calendar@group.calendar.google.com",
  SLACK_WEBHOOK_URL: "", // Slack incoming webhook URL, or '' to skip Slack
  EMAIL_TO: "", // e.g. 'team@jmhsrobotics.org', or '' to skip email
  TIMEZONE: "America/New_York",
  DAYS_AHEAD: 7, // days covered by the weekly schedule
  TITLE: "Weekly Team Schedule",
  NOTES_MAX_CHARS: 300, // event notes longer than this are cut off in reminders/alerts
  WEEKLY_NOTES_MAX_CHARS: 150, // shorter limit for notes in the weekly schedule
  DELETE_WATCH_DAYS: 90, // alert when an event in the next N days is deleted
  CATCH_UP_HOURS: 2, // send a reminder up to N hours late if a check runs late
  ALL_DAY_REMINDER_HOUR: 8, // all-day events: send reminders at 8am instead of midnight
};

// Defaults for any setting missing from CONFIG above (e.g. if you kept CONFIG from an older version).
const CONFIG_DEFAULTS = {
  TIMEZONE: "America/New_York",
  DAYS_AHEAD: 7,
  TITLE: "Weekly Team Schedule",
  NOTES_MAX_CHARS: 300,
  WEEKLY_NOTES_MAX_CHARS: 150,
  DELETE_WATCH_DAYS: 90,
  CATCH_UP_HOURS: 2,
  ALL_DAY_REMINDER_HOUR: 8,
  SLACK_WEBHOOK_URL: "",
  EMAIL_TO: "",
};
Object.keys(CONFIG_DEFAULTS).forEach((k) => {
  if (CONFIG[k] === undefined || CONFIG[k] === null)
    CONFIG[k] = CONFIG_DEFAULTS[k];
});

// ===================== Reminder types =====================
// An event gets these reminders when its title contains the tag (any capitalization).
// Events with none of these tags use the UNTAGGED reminders below.
//
// Message placeholders: {name} {date} {time} {countdown} {location} {notes}
// Location and notes are ALSO added automatically to the end of every reminder.
// Slack formatting works: *bold*, _italic_, <!channel> to ping everyone.
const REMINDER_TYPES = [
  {
    tag: "[COMP]",
    label: "Competition",
    emoji: ":trophy:",
    reminders: [
      {
        hours: 336,
        message:
          "*{name}* is 2 weeks away ({date}).\nLock in robot design changes, turn in permission and travel forms, and check the parts and spares list.",
      },
      {
        hours: 168,
        message:
          "*{name}* is 1 week away ({date}, {time}).\nFinish major mechanical work this week and get as much drive practice in as possible. Pit crew: start the packing list.",
      },
      {
        hours: 72,
        message:
          "*{name}* is 3 days away.\nCode freeze is coming. Final tuning and autonomous testing only. Make sure all batteries are labeled and on chargers.",
      },
      {
        hours: 48,
        message:
          "*{name}* is in 2 days.\nPack the pit: tools, spares, batteries, chargers, bumpers, safety glasses. Confirm rides and arrival time.",
      },
      {
        hours: 24,
        message:
          "*{name}* is tomorrow: {date}, {time}.\nRun the final checklist tonight. Bring safety glasses and team shirts, and get some sleep!",
      },
      {
        hours: 12,
        message: "<!channel> *{name}* starts in 12 hours ({time}). Let's go!",
      },
    ],
  },
  {
    tag: "[DRIVE]",
    label: "Drive",
    emoji: ":video_game:",
    reminders: [
      {
        hours: 120,
        message:
          "*Drive:* *{name}* is in {countdown} ({date}, {time}). Make sure the robot will be ready and the drive team can make it.",
      },
      {
        hours: 72,
        message:
          "*Drive:* *{name}* is in {countdown} ({date}, {time}). Batteries charged, controllers checked.",
      },
      { hours: 24, message: "*Drive:* *{name}* is tomorrow at {time}." },
      { hours: 12, message: "*Drive:* *{name}* starts in 12 hours ({time})." },
    ],
  },
  {
    tag: "[SAVE THE DATE]",
    label: "Save the Date",
    emoji: ":date:",
    reminders: [
      {
        hours: 8 * 168,
        message:
          "*Save the date:* *{name}* is {countdown} away ({date}). Put it on your calendar now!",
      },
      {
        hours: 7 * 168,
        message: "*Save the date:* *{name}* is {countdown} away ({date}).",
      },
      {
        hours: 6 * 168,
        message:
          "*Save the date:* *{name}* is {countdown} away ({date}). Watch for sign-up and permission forms.",
      },
      {
        hours: 5 * 168,
        message: "*Save the date:* *{name}* is {countdown} away ({date}).",
      },
      {
        hours: 4 * 168,
        message:
          "*Save the date:* *{name}* is {countdown} away ({date}). If you haven't signed up or turned in forms, do it this week.",
      },
      {
        hours: 3 * 168,
        message: "*Save the date:* *{name}* is {countdown} away ({date}).",
      },
      {
        hours: 2 * 168,
        message:
          "*Save the date:* *{name}* is {countdown} away ({date}). Confirm your rides and plans.",
      },
      {
        hours: 1 * 168,
        message: "*Save the date:* *{name}* is next week: {date}, {time}.",
      },
    ],
  },
  {
    tag: "[HOLIDAY]",
    label: "Holiday",
    emoji: ":tada:",
    reminders: [
      {
        hours: 3 * 168,
        message:
          "*Holiday heads-up:* *{name}* is {countdown} away ({date}). Check the schedule for any practice changes around it.",
      },
      {
        hours: 2 * 168,
        message:
          "*Holiday heads-up:* *{name}* is {countdown} away ({date}). If you'll be away or traveling, let your subteam lead know.",
      },
      {
        hours: 1 * 168,
        message:
          "*Holiday heads-up:* *{name}* is next week ({date}). Double-check the schedule for that week.",
      },
    ],
  },
];

// Reminders for events with NO tag.
// Set skipRecurring: true to stop reminders for repeating events (e.g. a practice every Tue/Thu),
// which otherwise get 4 reminders per occurrence.
const UNTAGGED = {
  tag: "",
  label: "",
  emoji: ":bell:",
  skipRecurring: false,
  reminders: [
    { hours: 336, message: "*{name}* is 2 weeks away ({date}, {time})." },
    { hours: 168, message: "*{name}* is 1 week away ({date}, {time})." },
    { hours: 72, message: "*{name}* is in 3 days ({date}, {time})." },
    { hours: 24, message: "*{name}* is tomorrow ({date}, {time})." },
  ],
};

// ===================== Monthly summary (peak season) =====================
// Sent on the 1st of each listed month: a very brief overview of that month.
// Each event goes in the first category whose text appears in its title (any capitalization).
//   list: 'names' → "NE District (Sat 3/14), ..."   list: 'dates' → "3/2, 3/4, 3/6, ..."
// Everything else is counted as "other events".
const MONTHLY = {
  MONTHS: [1, 2, 3, 4, 5], // January–May
  CATEGORIES: [
    { label: ":trophy: Competitions", match: "[COMP]", list: "names" },
    { label: ":date: Save the dates", match: "[SAVE THE DATE]", list: "names" },
    { label: ":tada: Holidays", match: "[HOLIDAY]", list: "names" },
    { label: ":wrench: Practices", match: "practice", list: "dates" },
  ],
};

const HOUR = 3600 * 1000;

// ===================== Weekly schedule =====================
function sendWeeklySchedule() {
  const cal = getCalendar_();
  const tz = CONFIG.TIMEZONE;
  const fmt = (d, pattern) => Utilities.formatDate(d, tz, pattern);
  const now = Date.now();

  const start = startOfDay_(new Date());
  const end = startOfDay_(
    new Date(start.getTime() + (CONFIG.DAYS_AHEAD * 24 + 12) * HOUR),
  );

  let msg = `:spiral_calendar_pad: *${CONFIG.TITLE}: ${fmt(start, "MMM d")} – ${fmt(new Date(end - 1), "MMM d")}*\n\n`;

  // --- This week's events, grouped by day ---
  const events = cal.getEvents(start, end);
  if (events.length === 0) {
    msg += "Nothing scheduled this week.\n\n";
  } else {
    const byDay = {};
    for (const e of events) {
      const s = e.getStartTime() < start ? start : e.getStartTime();
      const key = fmt(s, "yyyy-MM-dd");
      if (!byDay[key]) byDay[key] = { label: fmt(s, "EEEE, MMM d"), items: [] };
      byDay[key].items.push(e);
    }
    for (const key of Object.keys(byDay).sort()) {
      const day = byDay[key];
      msg += `*${day.label}*\n`;
      for (const e of day.items) {
        const time = e.isAllDayEvent()
          ? "All day"
          : `${fmt(e.getStartTime(), "h:mm a")}–${fmt(e.getEndTime(), "h:mm a")}`;
        msg += `• ${time}: *${slackEscape_(e.getTitle())}*\n`;
        if (e.getLocation())
          msg += `      :round_pushpin: _Location:_ ${slackEscape_(e.getLocation())}\n`;
        const notes = notesText_(
          e.getDescription(),
          CONFIG.WEEKLY_NOTES_MAX_CHARS,
        ).replace(/\n+/g, " ");
        if (notes) msg += `      :memo: _Notes:_ ${slackEscape_(notes)}\n`;
      }
      msg += "\n";
    }
  }

  // --- Upcoming competitions / save-the-dates and this week's reminders ---
  const upcoming = cal.getEvents(
    new Date(now),
    new Date(now + (maxReminderHours_() + 1) * HOUR),
  );
  const lines = [];
  for (const e of upcoming) {
    const type = getType_(e.getTitle());
    if (!type.tag) continue; // "Upcoming" lists tagged events only
    const startMs = e.getStartTime().getTime();
    if (startMs <= now) continue;
    const typeMax = Math.max(...type.reminders.map((r) => r.hours));
    if (startMs - now > typeMax * HOUR) continue; // reminders haven't started yet

    let line =
      `• ${type.emoji} *${type.label}:* ${slackEscape_(cleanName_(e.getTitle(), type))}` +
      ` (${fmt(e.getStartTime(), "EEE MMM d")}, ${timeUntil_(startMs - now)})`;
    if (e.getLocation()) line += ` @ ${slackEscape_(e.getLocation())}`;

    const thisWeek = type.reminders
      .map((r) => ({ r, due: dueMs_(startMs, e.isAllDayEvent(), r.hours) }))
      .filter((x) => x.due >= now && x.due < now + 7 * 24 * HOUR)
      .sort((a, b) => a.due - b.due)
      .map(
        (x) =>
          `${fmt(new Date(x.due), "EEE h:mm a")} (${countdownText_(x.r.hours)} out)`,
      );
    line += thisWeek.length
      ? `\n      _Reminders this week:_ ${thisWeek.join(", ")}`
      : `\n      _Reminders this week:_ none`;
    lines.push(line);
  }
  if (lines.length)
    msg += `:hourglass_flowing_sand: *Upcoming*\n${lines.join("\n")}\n`;

  send_(msg, `${CONFIG.TITLE} – week of ${fmt(start, "MMM d")}`);
}

// ===================== Monthly summary =====================
// Runs on the 1st of every month; only sends in the months listed in MONTHLY.MONTHS.
function sendMonthlySummary() {
  const start = startOfMonth_(new Date(), 0);
  const month = Number(Utilities.formatDate(start, CONFIG.TIMEZONE, "M"));
  if (!MONTHLY.MONTHS.includes(month)) return;
  send_(
    buildMonthlySummary_(start),
    `${Utilities.formatDate(start, CONFIG.TIMEZONE, "MMMM")} at a glance`,
  );
}

function buildMonthlySummary_(start) {
  const fmt = (d, p) => Utilities.formatDate(d, CONFIG.TIMEZONE, p);
  const end = startOfMonth_(start, 1);
  const events = getCalendar_().getEvents(start, end);

  const buckets = MONTHLY.CATEGORIES.map((c) => ({ c, items: [] }));
  let other = 0;
  for (const e of events) {
    const t = e.getTitle().toLowerCase();
    const b = buckets.find((x) => t.includes(x.c.match.toLowerCase()));
    if (b) b.items.push(e);
    else other++;
  }

  let msg = `:calendar: *${fmt(start, "MMMM yyyy")} at a glance*\n`;
  for (const { c, items } of buckets) {
    if (!items.length) continue;
    if (c.list === "dates") {
      const days = [...new Set(items.map((e) => fmt(e.getStartTime(), "M/d")))];
      msg += `*${c.label} (${days.length} days):* ${days.join(", ")}\n`;
    } else {
      msg +=
        `*${c.label}:* ` +
        items
          .map(
            (e) =>
              `${slackEscape_(stripTag_(e.getTitle(), c.match))} (${fmt(e.getStartTime(), "EEE M/d")})`,
          )
          .join(", ") +
        "\n";
    }
  }
  if (!events.length) msg += "Nothing on the calendar this month yet.\n";
  else if (other)
    msg += `_+${other} other event${other > 1 ? "s" : ""}. Details in the weekly updates._\n`;
  return msg;
}

// Logs the summary for the next in-season month (Jan–May). Sends NOTHING.
function previewMonthlySummary() {
  for (let k = 0; k < 12; k++) {
    const start = startOfMonth_(new Date(), k);
    if (
      MONTHLY.MONTHS.includes(
        Number(Utilities.formatDate(start, CONFIG.TIMEZONE, "M")),
      )
    ) {
      Logger.log(buildMonthlySummary_(start));
      return;
    }
  }
}

// ===================== Reminders =====================
// Runs every hour; sends each reminder once when it comes due.
function checkReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return; // busy; the next hourly run catches up
  try {
    checkRemindersLocked_();
  } finally {
    lock.releaseLock();
  }
}

function checkRemindersLocked_() {
  const cal = getCalendar_();
  const now = Date.now();
  const events = cal.getEvents(
    new Date(now),
    new Date(now + (maxReminderHours_() + 1) * HOUR),
  );

  const props = PropertiesService.getScriptProperties();
  const sent = props.getProperties();

  for (const e of events) {
    const type = getType_(e.getTitle());
    if (skipReminders_(type, e.isRecurringEvent())) continue;
    const startMs = e.getStartTime().getTime();
    if (startMs <= now) continue; // already started

    for (const r of type.reminders) {
      const lateBy = now - dueMs_(startMs, e.isAllDayEvent(), r.hours);
      const key = `rem|${type.tag}|${e.getId()}|${startMs}|${r.hours}`;
      if (lateBy >= 0 && lateBy < CONFIG.CATCH_UP_HOURS * HOUR && !sent[key]) {
        send_(
          reminderMessage_(r, e, type),
          `${type.label || "Reminder"}: ${cleanName_(e.getTitle(), type)}`,
        );
        props.setProperty(key, String(now));
      }
    }
  }
  pruneSentReminders_(props);
}

function reminderMessage_(r, e, type) {
  const tz = CONFIG.TIMEZONE;
  const start = e.getStartTime();
  const notes = notesText_(e.getDescription(), CONFIG.NOTES_MAX_CHARS);
  const values = {
    name: slackEscape_(cleanName_(e.getTitle(), type)),
    date: Utilities.formatDate(start, tz, "EEEE, MMM d"),
    time: e.isAllDayEvent()
      ? "all day"
      : Utilities.formatDate(start, tz, "h:mm a"),
    countdown: countdownText_(r.hours),
    location: slackEscape_(e.getLocation() || "TBD"),
    notes: slackEscape_(notes),
  };
  const body = r.message.replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? values[k] : m,
  );
  return `${type.emoji ? type.emoji + " " : ""}${body}\n${detailsBlock_(e.getLocation(), notes)}`;
}

// ===================== Deleted-event alerts =====================
// Keeps a snapshot of upcoming events and posts to Slack when one disappears because it was deleted.
// Runs whenever the calendar changes, plus hourly as a backup. Uses only CalendarApp (no extra services).
function checkDeletedEvents() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return; // another run is already checking
  try {
    const cal = getCalendar_();
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const now = Date.now();
    const windowEnd = now + CONFIG.DELETE_WATCH_DAYS * 24 * HOUR;
    const firstRun = !all["del_ready"];
    const lastWindowEnd = Number(all["del_until"] || 0);

    // Current upcoming events, grouped by ID (all occurrences of a recurring event share one ID)
    const current = {};
    for (const e of cal.getEvents(new Date(now), new Date(windowEnd))) {
      const id = e.getId();
      if (!current[id]) {
        current[id] = {
          t: e.getTitle(),
          a: e.isAllDayEvent(),
          r: e.isRecurringEvent(),
          l: e.getLocation() || "",
          n: notesText_(e.getDescription(), CONFIG.NOTES_MAX_CHARS),
          o: [],
        };
      }
      current[id].o.push([
        e.getStartTime().getTime(),
        e.getEndTime().getTime(),
      ]);
    }

    // Compare with the last snapshot
    const deleted = [];
    const removedKeys = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith("del|")) continue;
      const id = key.slice(4);
      const old = JSON.parse(all[key]);
      const upcoming = old.o.filter(([s, e]) => e > now); // occurrences that haven't ended
      const cur = current[id];

      if (!cur) {
        // Every occurrence is gone: deleted, unless it was moved outside the watch window
        removedKeys.push(key);
        if (
          !firstRun &&
          upcoming.length &&
          isGone_(cal, id, old, now, windowEnd)
        ) {
          deleted.push(Object.assign({}, old, { o: upcoming }));
        }
      } else if (!firstRun && old.r) {
        // Recurring event still exists: were some occurrences deleted (and not just moved)?
        const curStarts = new Set(cur.o.map((x) => x[0]));
        const oldStarts = new Set(old.o.map((x) => x[0]));
        const missing = upcoming.filter(([s]) => !curStarts.has(s));
        const added = cur.o.filter(
          ([s]) => !oldStarts.has(s) && s < lastWindowEnd,
        ); // ignore ones that just entered the window
        const extra = missing.length - added.length;
        if (extra > 0)
          deleted.push(
            Object.assign({}, old, {
              o: missing.slice(0, extra),
              partial: true,
            }),
          );
      }
    }

    // Not a real deletion if an event with the same title just appeared under a new ID. Google does this
    // when someone edits "this and following events" of a repeating event (it splits the series).
    const newTitles = new Set(
      Object.keys(current)
        .filter((id) => !all["del|" + id])
        .map((id) => current[id].t.toLowerCase()),
    );
    const realDeleted = deleted.filter(
      (d) => !newTitles.has(d.t.toLowerCase()),
    );

    if (realDeleted.length) notifyDeleted_(realDeleted); // alert BEFORE saving, so a Slack failure retries

    removedKeys.forEach((k) => props.deleteProperty(k));
    const updates = { del_ready: "1", del_until: String(windowEnd) };
    for (const id of Object.keys(current)) {
      const v = JSON.stringify(current[id]);
      if (all["del|" + id] !== v) updates["del|" + id] = v;
    }
    props.setProperties(updates);
  } finally {
    lock.releaseLock();
  }
}

// An event missing from the watch window: was it deleted, or moved further out?
function isGone_(cal, id, old, now, windowEnd) {
  if (old.r) return true; // a whole recurring series vanished from the next 90 days
  let ev;
  try {
    ev = cal.getEventById(id);
  } catch (err) {
    return true;
  }
  if (!ev) return true;
  // Google sometimes still returns deleted events by ID. If it would be inside the window, it should
  // have been listed, so it was deleted. If it's outside the window, it was moved.
  const s = ev.getStartTime().getTime(),
    e = ev.getEndTime().getTime();
  return e > now && s < windowEnd;
}

function notifyDeleted_(items) {
  const now = Date.now();
  for (const d of items) {
    d.o.sort((x, y) => x[0] - y[0]);
    const type = getType_(d.t);
    const name = cleanName_(d.t, type);
    const label = type.label ? `${type.label} ` : "";
    const first = { s: d.o[0][0], a: d.a };

    let msg = `:wastebasket: *Deleted from the calendar:* ${label}*${slackEscape_(name)}*\n`;
    if (d.o.length > 1) {
      msg += `_When:_ ${d.o.length} upcoming occurrences, starting ${whenText_(first)}\n`;
    } else {
      msg += `_When:_ ${whenText_(first)}${d.partial ? " (this occurrence only)" : ""}\n`;
    }
    msg += detailsBlock_(d.l, d.n);

    // A deleted event's reminders stop automatically; say how many were cancelled.
    const cancelled = skipReminders_(type, d.r)
      ? 0
      : d.o.reduce(
          (n, [s]) =>
            n +
            type.reminders.filter((r) => dueMs_(s, d.a, r.hours) > now).length,
          0,
        );
    if (cancelled)
      msg += `\n_${cancelled} upcoming reminder${cancelled > 1 ? "s" : ""} cancelled._`;

    send_(msg, `Deleted: ${name}`);
  }
}

function whenText_(snap) {
  const d = new Date(snap.s);
  return snap.a
    ? `${Utilities.formatDate(d, CONFIG.TIMEZONE, "EEEE, MMM d")} (all day)`
    : Utilities.formatDate(d, CONFIG.TIMEZONE, "EEEE, MMM d, h:mm a");
}

// ===================== Setup =====================
// Run ONCE (and again after changing CALENDAR_ID or trigger times). Replaces old triggers.
function createTriggers() {
  const handlers = [
    "sendWeeklySchedule",
    "sendMonthlySummary",
    "checkReminders",
    "checkDeletedEvents",
    "checkCompetitionReminders",
  ];
  ScriptApp.getProjectTriggers()
    .filter((t) => handlers.includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("sendWeeklySchedule")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  ScriptApp.newTrigger("sendMonthlySummary")
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  ScriptApp.newTrigger("checkReminders").timeBased().everyHours(1).create();

  ScriptApp.newTrigger("checkDeletedEvents")
    .forUserCalendar(CONFIG.CALENDAR_ID)
    .onEventUpdated()
    .create();
  ScriptApp.newTrigger("checkDeletedEvents").timeBased().everyHours(1).create();

  checkDeletedEvents(); // takes the first snapshot (no alerts on the first run)
}

// ===================== Preview & debugging =====================
// Logs every upcoming reminder and when it will send. Sends NOTHING.
function previewReminders() {
  const cal = getCalendar_();
  const now = Date.now();
  const events = cal.getEvents(new Date(now), new Date(now + 60 * 24 * HOUR));
  let found = 0;
  for (const e of events) {
    const type = getType_(e.getTitle());
    if (skipReminders_(type, e.isRecurringEvent())) continue;
    found++;
    Logger.log(
      `===== ${type.label || "No tag"}: ${cleanName_(e.getTitle(), type)} =====`,
    );
    for (const r of type.reminders) {
      const due = new Date(
        dueMs_(e.getStartTime().getTime(), e.isAllDayEvent(), r.hours),
      );
      const when = Utilities.formatDate(
        due,
        CONFIG.TIMEZONE,
        "EEE MMM d, h:mm a",
      );
      const status =
        due.getTime() < now ? " (already passed, will not send)" : "";
      Logger.log(
        `[${countdownText_(r.hours)} before → ${when}${status}]\n${reminderMessage_(r, e, type)}\n`,
      );
    }
  }
  if (!found)
    Logger.log(
      "No events with reminders in the next 60 days. Run debugTagMatching to see why.",
    );
}

// Logs what the weekly schedule would look like. Sends NOTHING.
function previewWeeklySchedule() {
  const saved = { slack: CONFIG.SLACK_WEBHOOK_URL, email: CONFIG.EMAIL_TO };
  CONFIG.SLACK_WEBHOOK_URL = "";
  CONFIG.EMAIL_TO = "";
  try {
    sendWeeklySchedule();
  } finally {
    CONFIG.SLACK_WEBHOOK_URL = saved.slack;
    CONFIG.EMAIL_TO = saved.email;
  }
}

// Posts ONE sample message to Slack showing every reminder style + a deletion alert, so you can see the formatting.
function sendTestMessage() {
  const start = new Date(Date.now() + 7 * 24 * HOUR);
  const fake = {
    getTitle: () => "Sample Event",
    getStartTime: () => start,
    getEndTime: () => new Date(start.getTime() + 2 * HOUR),
    isAllDayEvent: () => false,
    getLocation: () => "JMHS Robotics Lab",
    getDescription: () => "These are sample notes from the event description.",
    getId: () => "test",
  };
  const parts = REMINDER_TYPES.concat([UNTAGGED]).map(
    (type) =>
      `*${type.label || "No tag"}*\n` +
      reminderMessage_(type.reminders[0], fake, type),
  );
  parts.push(
    ":wastebasket: *Deleted from the calendar:* *Sample Event*\n_When:_ " +
      whenText_({ s: start.getTime(), a: false }) +
      "\n" +
      detailsBlock_("JMHS Robotics Lab", "Sample notes"),
  );
  send_(
    ":test_tube: *TEST: Schedule Bot message styles* (ignore this)\n\n" +
      parts.join("\n\n―――――\n\n"),
    "Schedule Bot test",
  );
}

// Lists every event in the next 90 days and which reminder type (if any) it matches.
function debugTagMatching() {
  const cal = getCalendar_();
  Logger.log(`Calendar: "${cal.getName()}" (${CONFIG.CALENDAR_ID})`);
  Logger.log(`Tags: ${REMINDER_TYPES.map((t) => t.tag).join(", ")}`);
  const now = Date.now();
  const events = cal.getEvents(new Date(now), new Date(now + 90 * 24 * HOUR));
  Logger.log(`${events.length} events in the next 90 days:`);
  for (const e of events) {
    const type = getType_(e.getTitle());
    const when = Utilities.formatDate(
      e.getStartTime(),
      CONFIG.TIMEZONE,
      "EEE MMM d",
    );
    Logger.log(
      `${(type.tag ? type.label : "(no tag)").padEnd(14)} ${when}  ${e.getTitle()}`,
    );
  }
}

// ===================== Helpers =====================
function getCalendar_() {
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!cal) throw new Error("Calendar not found: " + CONFIG.CALENDAR_ID);
  return cal;
}

function getType_(title) {
  const t = (title || "").toLowerCase();
  return (
    REMINDER_TYPES.find((type) => t.includes(type.tag.toLowerCase())) ||
    UNTAGGED
  );
}

// True if this event should get no reminders (only possible for untagged recurring events).
function skipReminders_(type, isRecurring) {
  return !type.tag && UNTAGGED.skipRecurring && isRecurring;
}

function cleanName_(title, type) {
  return stripTag_(title, type.tag);
}

// Removes a [TAG] from a title. Plain words (like "practice") are left in place.
function stripTag_(title, tag) {
  if (!tag.startsWith("[")) return title;
  const i = title.toLowerCase().indexOf(tag.toLowerCase());
  if (i === -1) return title;
  return (title.slice(0, i) + title.slice(i + tag.length))
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Midnight (in CONFIG.TIMEZONE) at the start of the day containing `date`.
function startOfDay_(date) {
  const tz = CONFIG.TIMEZONE;
  return Utilities.parseDate(
    Utilities.formatDate(date, tz, "yyyy-MM-dd"),
    tz,
    "yyyy-MM-dd",
  );
}

// Midnight (in CONFIG.TIMEZONE) on the 1st of the month `offset` months after `date`'s month.
function startOfMonth_(date, offset) {
  const tz = CONFIG.TIMEZONE;
  let y = Number(Utilities.formatDate(date, tz, "yyyy"));
  let m = Number(Utilities.formatDate(date, tz, "M")) - 1 + offset;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return Utilities.parseDate(
    `${y}-${String(m + 1).padStart(2, "0")}-01`,
    tz,
    "yyyy-MM-dd",
  );
}

// When a reminder is due. All-day events start at midnight, so their reminders are moved to ALL_DAY_REMINDER_HOUR.
function dueMs_(startMs, isAllDay, hours) {
  return (
    startMs -
    hours * HOUR +
    (isAllDay ? CONFIG.ALL_DAY_REMINDER_HOUR * HOUR : 0)
  );
}

function maxReminderHours_() {
  return Math.max(
    ...REMINDER_TYPES.concat([UNTAGGED]).flatMap((t) =>
      t.reminders.map((r) => r.hours),
    ),
  );
}

function countdownText_(hours) {
  if (hours % 168 === 0) {
    const w = hours / 168;
    return `${w} week${w > 1 ? "s" : ""}`;
  }
  if (hours % 24 === 0) {
    const d = hours / 24;
    return `${d} day${d > 1 ? "s" : ""}`;
  }
  return `${hours} hours`;
}

function timeUntil_(ms) {
  const days = Math.round(ms / (24 * HOUR));
  if (days >= 14) return `in ${Math.round(days / 7)} weeks`;
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  return "today";
}

// "Location / Notes" block added to every reminder and deletion alert. Takes plain text.
function detailsBlock_(location, notes) {
  let block = `:round_pushpin: _Location:_ ${location ? slackEscape_(location) : "not listed"}`;
  if (notes) block += `\n:memo: _Notes:_ ${slackEscape_(notes)}`;
  return block;
}

// Turns a Google Calendar description (which may contain HTML) into plain text.
function notesText_(html, maxChars) {
  if (!html) return "";
  let text = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (m, url, label) =>
      label && label !== url ? `${label} (${url})` : url,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trim() + "…";
  return text;
}

// Slack treats & < > as special characters in message text.
function slackEscape_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function send_(msg, subject) {
  if (CONFIG.SLACK_WEBHOOK_URL) {
    const res = UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      payload: JSON.stringify({ text: msg }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      throw new Error(
        `Slack rejected the message (${res.getResponseCode()}): ${res.getContentText()}`,
      );
    }
  }
  if (CONFIG.EMAIL_TO) {
    const body = msg
      .replace(/:([a-z_]+):/g, (m, code) => EMAIL_EMOJI[code] || m)
      .replace(/<!channel>\s*/g, "")
      .replace(/\*/g, "")
      .replace(/_([A-Za-z ]+:)_/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    MailApp.sendEmail({ to: CONFIG.EMAIL_TO, subject: subject, body: body });
  }
  Logger.log(msg);
}

// Slack shows :shortcodes: as emoji; email doesn't, so swap them for the real characters there.
const EMAIL_EMOJI = {
  trophy: "🏆",
  video_game: "🎮",
  date: "📅",
  tada: "🎉",
  bell: "🔔",
  round_pushpin: "📍",
  memo: "📝",
  spiral_calendar_pad: "🗓️",
  hourglass_flowing_sand: "⏳",
  wastebasket: "🗑️",
  calendar: "📆",
  wrench: "🔧",
};

// Forget sent-reminder records for events that started more than 2 days ago.
function pruneSentReminders_(props) {
  const cutoff = Date.now() - 2 * 24 * HOUR;
  for (const key of Object.keys(props.getProperties())) {
    if (!key.startsWith("rem|")) continue;
    const parts = key.split("|");
    const startMs = Number(parts[parts.length - 2]);
    if (startMs < cutoff) props.deleteProperty(key);
  }
}
