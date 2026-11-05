process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSchedule,
  subtractBusy,
  availabilityWindows,
  dayKey,
  MIN,
} from '../extension/lib/scheduler.js';

// Monday Nov 9 2026, 12:00 local.
const NOW = new Date(2026, 10, 9, 12, 0).getTime();
const at = (day, h, m = 0) => new Date(2026, 10, 9 + day, h, m).getTime();
const total = (blocks, id) => blocks.filter((b) => !id || b.taskId === id).reduce((s, b) => s + (b.end - b.start) / MIN, 0);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('availability uses weekday and weekend hours', () => {
  const w = availabilityWindows(at(0, 0), at(7, 0), {});
  assert.equal(w.length, 7);
  assert.equal(new Date(w[0].start).getHours(), 15); // Monday 15:30
  const sat = w.find((x) => new Date(x.start).getDay() === 6);
  assert.equal(new Date(sat.start).getHours(), 10);
});

test('days marked off get no availability', () => {
  const w = availabilityWindows(at(0, 0), at(7, 0), { weekend: { off: true } });
  assert.equal(w.length, 5);
});

test('subtractBusy cuts events (with buffer) out of windows', () => {
  const free = subtractBusy([{ start: at(0, 16), end: at(0, 20) }], [{ start: at(0, 17), end: at(0, 18) }], 10);
  assert.deepEqual(free, [
    { start: at(0, 16), end: at(0, 16, 50) },
    { start: at(0, 18, 10), end: at(0, 20) },
  ]);
});

test('subtractBusy merges overlapping events', () => {
  const free = subtractBusy(
    [{ start: at(0, 16), end: at(0, 22) }],
    [
      { start: at(0, 17), end: at(0, 18) },
      { start: at(0, 17, 30), end: at(0, 19) },
    ],
  );
  assert.deepEqual(free, [
    { start: at(0, 16), end: at(0, 17) },
    { start: at(0, 19), end: at(0, 22) },
  ]);
});

test('schedules the full estimate before the deadline, inside study hours', () => {
  const tasks = [{ id: 'a', title: 'Essay', due: at(3, 23, 59), estimatedMinutes: 150 }];
  const { blocks, unscheduled } = planSchedule({ tasks, now: NOW });
  assert.equal(total(blocks), 150);
  assert.equal(unscheduled.length, 0);
  for (const b of blocks) {
    assert.ok(b.end <= tasks[0].due - 120 * MIN, 'finishes 2h early');
    const h = new Date(b.start).getHours() + new Date(b.start).getMinutes() / 60;
    assert.ok(h >= 15.5 && h < 22, 'within weekday hours');
  }
});

test('never overlaps existing events', () => {
  const busy = [];
  for (let d = 0; d < 5; d++) {
    busy.push({ start: at(d, 16), end: at(d, 17, 30) });
    busy.push({ start: at(d, 18), end: at(d, 19) });
  }
  const tasks = [
    { id: 'a', title: 'A', due: at(4, 23), estimatedMinutes: 200 },
    { id: 'b', title: 'B', due: at(2, 23), estimatedMinutes: 90 },
  ];
  const { blocks } = planSchedule({ tasks, busy, now: NOW, settings: { bufferMinutes: 10 } });
  assert.ok(blocks.length > 0);
  for (const b of blocks) {
    for (const e of busy) {
      assert.ok(!overlaps(b, { start: e.start - 10 * MIN, end: e.end + 10 * MIN }), 'respects buffer');
    }
  }
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].start >= blocks[i - 1].end, 'blocks do not overlap each other');
});

test('respects the daily study limit', () => {
  const tasks = [
    { id: 'a', title: 'A', due: at(3, 23), estimatedMinutes: 300 },
    { id: 'b', title: 'B', due: at(3, 23), estimatedMinutes: 300 },
  ];
  const { blocks } = planSchedule({ tasks, now: NOW, settings: { maxMinutesPerDay: 120 } });
  const perDay = {};
  for (const b of blocks) perDay[dayKey(b.start)] = (perDay[dayKey(b.start)] || 0) + (b.end - b.start) / MIN;
  for (const m of Object.values(perDay)) assert.ok(m <= 120, `day total ${m} <= 120`);
});

test('spreads big assignments across several days', () => {
  const tasks = [{ id: 'a', title: 'Project', due: at(6, 23), estimatedMinutes: 240 }];
  const { blocks } = planSchedule({ tasks, now: NOW });
  assert.equal(total(blocks), 240);
  assert.ok(new Set(blocks.map((b) => dayKey(b.start))).size >= 3);
});

test('earliest deadline gets the first free time', () => {
  const tasks = [
    { id: 'later', title: 'Later', due: at(5, 23), estimatedMinutes: 60 },
    { id: 'soon', title: 'Soon', due: at(1, 23), estimatedMinutes: 60 },
  ];
  const { blocks } = planSchedule({ tasks, now: NOW });
  const firstSoon = Math.min(...blocks.filter((b) => b.taskId === 'soon').map((b) => b.start));
  const firstLater = Math.min(...blocks.filter((b) => b.taskId === 'later').map((b) => b.start));
  assert.ok(firstSoon <= firstLater);
});

test('reports work that does not fit', () => {
  const tasks = [{ id: 'a', title: 'Huge', due: at(1, 18), estimatedMinutes: 600 }];
  const { unscheduled } = planSchedule({ tasks, now: NOW });
  assert.equal(unscheduled.length, 1);
  assert.equal(unscheduled[0].reason, 'no-time');
  assert.ok(unscheduled[0].remainingMinutes > 0);
});

test('skips finished and past-due tasks; flags tasks due inside the finish-early margin', () => {
  const tasks = [
    { id: 'done', title: 'Done', due: at(2, 23), estimatedMinutes: 60, done: true },
    { id: 'past', title: 'Past', due: at(-1, 23), estimatedMinutes: 60 },
    { id: 'soon', title: 'Soon', due: NOW + 60 * MIN, estimatedMinutes: 60 },
  ];
  const { blocks, unscheduled } = planSchedule({ tasks, now: NOW });
  assert.equal(blocks.length, 0);
  assert.deepEqual(unscheduled.map((u) => [u.taskId, u.reason]), [['soon', 'too-soon']]);
});

test('no blocks shorter than the minimum', () => {
  const busy = [{ start: at(0, 15, 30), end: at(0, 15, 50) }];
  const tasks = [{ id: 'a', title: 'A', due: at(2, 23), estimatedMinutes: 100 }];
  const { blocks } = planSchedule({ tasks, busy, now: NOW, settings: { bufferMinutes: 0 } });
  for (const b of blocks) assert.ok((b.end - b.start) / MIN >= 20);
});
