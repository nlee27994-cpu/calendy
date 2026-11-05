// Calendy scheduling engine.
//
// Pure functions only (no Chrome or Google APIs) so it can be unit tested
// with `node --test`. All times are epoch milliseconds; "days" follow the
// user's local time zone.

export const MIN = 60_000;

export const DEFAULT_SETTINGS = {
  // When you're willing to do schoolwork. Set `off: true` to skip a day type.
  weekday: { start: '15:30', end: '22:00', off: false },
  weekend: { start: '10:00', end: '20:00', off: false },
  maxMinutesPerDay: 180, // total study time per day, across all classes
  blockMinutes: 45, // preferred length of one study block
  minBlockMinutes: 20, // never schedule a block shorter than this
  breakMinutes: 10, // gap between two study blocks
  bufferMinutes: 10, // gap kept before/after your existing events
  finishBeforeDueMinutes: 120, // aim to be done this long before the deadline
  horizonDays: 14, // how far ahead to plan
};

export function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    weekday: { ...DEFAULT_SETTINGS.weekday, ...(settings.weekday || {}) },
    weekend: { ...DEFAULT_SETTINGS.weekend, ...(settings.weekend || {}) },
  };
}

export function parseHM(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(dayStartMs, n) {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + n); // DST-safe, unlike adding 24h
  return d.getTime();
}

function atMinutes(dayStartMs, minutes) {
  const d = new Date(dayStartMs);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function roundUp(ms, step) {
  return Math.ceil(ms / step) * step;
}

/** The hours you're available for schoolwork, one window per day, clipped to [from, to). */
export function availabilityWindows(from, to, settings) {
  const s = mergeSettings(settings);
  const windows = [];
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    const dow = new Date(day).getDay();
    const w = dow === 0 || dow === 6 ? s.weekend : s.weekday;
    if (w.off) continue;
    const start = Math.max(atMinutes(day, parseHM(w.start)), from);
    const end = Math.min(atMinutes(day, parseHM(w.end)), to);
    if (end > start) windows.push({ start, end });
  }
  return windows;
}

/** Remove busy time (padded by `bufferMinutes`) from the windows, leaving free slots. */
export function subtractBusy(windows, busy, bufferMinutes = 0) {
  const pad = bufferMinutes * MIN;
  const merged = [];
  for (const b of [...busy]
    .map((b) => ({ start: b.start - pad, end: b.end + pad }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const free = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= w.end) continue;
      if (b.start > cursor) free.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) free.push({ start: cursor, end: w.end });
  }
  return free;
}

/**
 * Plan study blocks for a list of tasks around existing calendar events.
 *
 * tasks: [{ id, title, due, estimatedMinutes, courseId?, courseName?, kind?, done? }]
 * busy:  [{ start, end }] — existing events to work around
 *
 * Strategy:
 *  1. Earliest deadline first, so urgent work gets the first pick of free time.
 *  2. Each task is spread over the days before its deadline instead of being
 *     crammed into one night (pass 1), then any leftover goes into the earliest
 *     remaining free time (pass 2).
 *  3. Blocks never overlap existing events (plus a buffer), never exceed the
 *     daily study cap, and leave a break between consecutive blocks.
 *
 * Returns { blocks, unscheduled, range }. `unscheduled` lists tasks that didn't
 * fully fit: reason "no-time" (not enough free time before the deadline),
 * "too-soon" (deadline already inside the finish-early margin) or
 * "beyond-horizon" (due after the planning window; it'll be planned later).
 */
export function planSchedule({ tasks, busy = [], settings = {}, now = Date.now() }) {
  const s = mergeSettings(settings);
  const start = roundUp(now, 15 * MIN);
  const horizonEnd = addDays(startOfDay(start), s.horizonDays + 1);

  const active = tasks
    .filter((t) => !t.done && t.due && t.due > start && t.estimatedMinutes > 0)
    .sort((a, b) => a.due - b.due || b.estimatedMinutes - a.estimatedMinutes);

  const blocks = [];
  const unscheduled = [];
  if (!active.length) return { blocks, unscheduled, range: { start, end: start } };

  const end = Math.min(horizonEnd, Math.max(...active.map((t) => t.due)));
  const slots = subtractBusy(availabilityWindows(start, end, s), busy, s.bufferMinutes);
  const dayUsed = new Map();

  // `floor`: shortest block allowed for this task (only below minBlockMinutes
  // when the whole remaining task is that small).
  function place(task, day, wanted, deadline, floor) {
    const key = dayKey(day);
    let placed = 0;
    for (const slot of slots) {
      if (wanted - placed < 5) break;
      if (slot.start >= deadline) break; // slots are in time order
      if (dayKey(slot.start) !== key) continue;
      while (wanted - placed >= 5) {
        const used = dayUsed.get(key) || 0;
        const capLeft = s.maxMinutesPerDay - used;
        const avail = Math.floor((Math.min(slot.end, deadline) - slot.start) / MIN);
        const want = wanted - placed;
        let len = Math.min(s.blockMinutes, want, avail, capLeft);
        if (len <= 0 || len < floor) break;
        // Don't leave a sliver smaller than a minimum block for later.
        const rest = want - len;
        if (rest > 0 && rest < s.minBlockMinutes && avail >= want && capLeft >= want) len = want;

        blocks.push({
          taskId: task.id,
          title: task.title,
          courseId: task.courseId,
          courseName: task.courseName,
          kind: task.kind,
          due: task.due,
          start: slot.start,
          end: slot.start + len * MIN,
        });
        placed += len;
        dayUsed.set(key, used + len);
        slot.start += (len + s.breakMinutes) * MIN;
        if (slot.start >= slot.end) break;
      }
      if ((dayUsed.get(key) || 0) >= s.maxMinutesPerDay) break;
    }
    return placed;
  }

  for (const task of active) {
    const deadline = Math.min(task.due - s.finishBeforeDueMinutes * MIN, horizonEnd);
    let remaining = task.estimatedMinutes;
    if (deadline <= start) {
      unscheduled.push({ taskId: task.id, title: task.title, remainingMinutes: remaining, reason: 'too-soon' });
      continue;
    }

    const days = [];
    for (let d = startOfDay(start); d < deadline; d = addDays(d, 1)) days.push(d);

    // Pass 1: spread the work across the available days, at least one full
    // block per day, so a big project becomes a few real sessions, not a
    // dozen tiny ones.
    const perDay = Math.max(Math.min(s.blockMinutes, remaining), Math.ceil(remaining / days.length / 5) * 5);
    for (const day of days) {
      if (remaining < 5) break;
      let want = Math.min(perDay, remaining);
      if (remaining - want < s.minBlockMinutes) want = remaining; // don't leave a sliver
      remaining -= place(task, day, want, deadline, Math.min(s.minBlockMinutes, remaining));
    }
    // Pass 2: put whatever is left into the earliest free time.
    for (const day of days) {
      if (remaining < 5) break;
      remaining -= place(task, day, remaining, deadline, Math.min(s.minBlockMinutes, remaining));
    }

    if (remaining >= 5) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        remainingMinutes: remaining,
        reason: task.due > horizonEnd ? 'beyond-horizon' : 'no-time',
      });
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, unscheduled, range: { start, end } };
}
