// Google Calendar: read your existing events and write study blocks.

import { gfetch, listAll } from './google.js';

const BASE = 'https://www.googleapis.com/calendar/v3';
// Every event Calendy creates is tagged with this, so it can find and replace its own blocks.
const TAG = { calendy: 'study' };

export async function listCalendars() {
  const items = await listAll(`${BASE}/users/me/calendarList`, 'items', { minAccessRole: 'freeBusyReader' });
  return items.map((c) => ({
    id: c.id,
    name: c.summaryOverride || c.summary,
    primary: !!c.primary,
    color: c.backgroundColor,
    defaultOn: !!c.primary || (c.selected && !/holiday|birthday|#contacts|#holiday/i.test(c.id)),
  }));
}

function isCalendy(e) {
  return e.extendedProperties?.private?.calendy === TAG.calendy;
}

/**
 * Events that should block study time, from the chosen calendars.
 * Skips: Calendy's own blocks, events marked "Free", events you declined,
 * and all-day events (unless blockAllDay is on).
 */
export async function fetchBusy({ calendarIds, timeMin, timeMax, blockAllDay = false }) {
  const busy = [];
  await Promise.all(
    calendarIds.map(async (calendarId) => {
      const events = await listAll(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, 'items', {
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
      });
      for (const e of events) {
        if (e.status === 'cancelled' || e.transparency === 'transparent' || isCalendy(e)) continue;
        if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
        const allDay = !e.start?.dateTime;
        if (allDay && !blockAllDay) continue;
        const start = allDay ? new Date(`${e.start.date}T00:00`).getTime() : Date.parse(e.start.dateTime);
        const end = allDay ? new Date(`${e.end.date}T00:00`).getTime() : Date.parse(e.end.dateTime);
        busy.push({ start, end, title: e.summary || '(busy)', calendarId, allDay });
      }
    }),
  );
  return busy.sort((a, b) => a.start - b.start);
}

/** Delete Calendy study blocks on your main calendar from `from` onward. Returns how many. */
export async function clearCalendyBlocks(from = Date.now()) {
  const events = await listAll(`${BASE}/calendars/primary/events`, 'items', {
    timeMin: new Date(from).toISOString(),
    privateExtendedProperty: 'calendy=study',
    singleEvents: true,
    maxResults: 2500,
  });
  for (const e of events) {
    await gfetch(`${BASE}/calendars/primary/events/${e.id}`, { method: 'DELETE' });
  }
  return events.length;
}

/** Add study blocks to your main calendar. */
export async function writeBlocks(blocks, { onProgress } = {}) {
  let done = 0;
  for (const b of blocks) {
    await gfetch(`${BASE}/calendars/primary/events`, {
      method: 'POST',
      body: {
        summary: `📚 ${b.title}`,
        description: [
          b.courseName && `Class: ${b.courseName}`,
          b.due && `Due: ${new Date(b.due).toLocaleString()}`,
          'Planned by Calendy. Re-planning replaces these blocks.',
        ]
          .filter(Boolean)
          .join('\n'),
        start: { dateTime: new Date(b.start).toISOString() },
        end: { dateTime: new Date(b.end).toISOString() },
        colorId: '9',
        transparency: 'opaque',
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
        extendedProperties: { private: { ...TAG, taskId: b.taskId } },
      },
    });
    onProgress?.(++done, blocks.length);
  }
  return done;
}
