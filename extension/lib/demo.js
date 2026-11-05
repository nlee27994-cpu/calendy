// Fake data so you can try Calendy without connecting Google.

import { kindOf, estimateMinutes } from './assignments.js';
import { addDays, startOfDay } from './scheduler.js';

function at(dayOffset, hm, now) {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(addDays(startOfDay(now), dayOffset));
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function demoData(now = Date.now()) {
  const courses = [
    { id: 'bio', name: 'AP Biology', section: 'Period 2' },
    { id: 'eng', name: 'English 11', section: 'Period 4' },
    { id: 'alg', name: 'Algebra II', section: 'Period 1' },
    { id: 'hist', name: 'US History', section: 'Period 6' },
  ];
  const name = Object.fromEntries(courses.map((c) => [c.id, c.name]));
  const raw = [
    ['alg', 'Worksheet 4.3: Quadratic Functions', 1, '23:59'],
    ['bio', 'Unit 3 Test: Cell Structure', 3, '08:00'],
    ['eng', 'Essay: The Great Gatsby and the American Dream', 6, '23:59'],
    ['hist', 'Reading: Chapter 12 + notes', 2, '23:59'],
    ['bio', 'Lab Report: Osmosis in Potato Cells', 8, '23:59'],
    ['alg', 'Quiz 4 (4.1–4.4)', 5, '09:00'],
    ['hist', 'Civil Rights Movement Project', 12, '23:59'],
  ];
  const assignments = raw.map(([courseId, title, day, time], i) => ({
    id: `demo-${i}`,
    courseId,
    courseName: name[courseId],
    title,
    description: 'This is demo data. Connect Google to see your real assignments.',
    url: null,
    due: at(day, time, now),
    state: 'CREATED',
    done: false,
    kind: kindOf(title),
    estimatedMinutes: estimateMinutes({ title }),
    materials: [],
  }));

  const busy = [];
  for (let d = 0; d < 15; d++) {
    const dow = new Date(addDays(startOfDay(now), d)).getDay();
    const weekend = dow === 0 || dow === 6;
    busy.push({ start: at(d, '18:00', now), end: at(d, '18:45', now), title: 'Dinner' });
    if (dow === 2 || dow === 4) busy.push({ start: at(d, '15:45', now), end: at(d, '17:30', now), title: 'Soccer practice' });
    if (dow === 6) busy.push({ start: at(d, '11:00', now), end: at(d, '16:00', now), title: 'Work shift' });
    if (dow === 5) busy.push({ start: at(d, '19:00', now), end: at(d, '22:00', now), title: 'Football game' });
    if (dow === 3) busy.push({ start: at(d, '16:00', now), end: at(d, '17:00', now), title: 'Dentist' });
    if (!weekend && dow === 1) busy.push({ start: at(d, '19:30', now), end: at(d, '20:30', now), title: 'Youth group' });
  }
  return { courses, assignments, busy };
}
