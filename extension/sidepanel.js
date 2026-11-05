import { planSchedule, mergeSettings, dayKey, startOfDay, addDays, MIN } from './lib/scheduler.js';
import { fetchClassroom } from './lib/classroom.js';
import { listCalendars, fetchBusy, clearCalendyBlocks, writeBlocks } from './lib/calendar.js';
import { downloadAssignment } from './lib/downloader.js';
import { getToken, signOut } from './lib/google.js';
import { demoData } from './lib/demo.js';
import { load, save } from './lib/storage.js';

const inExtension = typeof chrome !== 'undefined' && !!chrome.identity;
const view = document.getElementById('view');

const state = {
  mode: null, // 'google' | 'demo'
  tab: 'assignments',
  courses: [],
  assignments: [],
  calendars: [],
  calendarIds: null, // calendars whose events block study time
  demoBusy: [],
  plan: null,
  planBusy: [],
  planWritten: false,
  settings: mergeSettings(),
  blockAllDay: false,
  overrides: {}, // assignmentId -> { minutes?, skip? }
};

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PALETTE = ['#4c6ef5', '#12b886', '#f76707', '#be4bdb', '#1c7ed6', '#e64980', '#2f9e44', '#fab005', '#7048e8', '#0ca678'];
function courseColor(courseId) {
  const i = state.courses.findIndex((c) => c.id === courseId);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

function relDay(ms, now = Date.now()) {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / (24 * 60 * MIN));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dayFmt.format(ms);
}
const fmtDue = (ms) => (ms ? `${relDay(ms)} · ${timeFmt.format(ms)}` : 'No due date');

function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

function minutesFor(a) {
  return state.overrides[a.id]?.minutes ?? a.estimatedMinutes;
}
function skipped(a) {
  return !!state.overrides[a.id]?.skip;
}

let statusCount = 0;
function setStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.hidden = false;
}
async function withStatus(text, fn) {
  statusCount++;
  setStatus(text);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  } finally {
    if (--statusCount === 0) document.getElementById('status').hidden = true;
  }
}

let toastTimer;
function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${error ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), error ? 7000 : 3500);
}

// ---------- loading ----------

async function connectGoogle() {
  if (!inExtension) {
    toast('Google sign-in only works inside the Chrome extension. Try the demo instead.', true);
    return;
  }
  await withStatus('Connecting to Google…', async () => {
    await getToken(true);
    state.mode = 'google';
    await save('mode', 'google');
    await refreshGoogle();
  });
}

async function refreshGoogle() {
  setStatus('Loading Google Classroom…');
  const [classroom, calendars] = await Promise.all([fetchClassroom(), listCalendars()]);
  state.courses = classroom.courses;
  state.assignments = classroom.assignments;
  state.calendars = calendars;
  if (!state.calendarIds) state.calendarIds = calendars.filter((c) => c.defaultOn).map((c) => c.id);
  state.plan = null;
  if (classroom.errors.length) toast(`Some classes couldn't load: ${classroom.errors[0]}`, true);
  render();
}

function startDemo() {
  const d = demoData();
  state.mode = 'demo';
  state.courses = d.courses;
  state.assignments = d.assignments;
  state.demoBusy = d.busy;
  state.calendars = [];
  state.plan = null;
  save('mode', 'demo');
  render();
}

async function leave() {
  if (state.mode === 'google') await signOut();
  state.mode = null;
  state.assignments = [];
  state.plan = null;
  await save('mode', null);
  render();
}

// ---------- planning ----------

function planTasks() {
  return state.assignments
    .filter((a) => !a.done && a.due && !skipped(a))
    .map((a) => ({ ...a, estimatedMinutes: minutesFor(a) }));
}

async function makePlan() {
  await withStatus('Checking your calendar and planning…', async () => {
    const now = Date.now();
    const horizonEnd = addDays(startOfDay(now), state.settings.horizonDays + 1);
    const busy =
      state.mode === 'google'
        ? await fetchBusy({
            calendarIds: state.calendarIds || ['primary'],
            timeMin: now,
            timeMax: horizonEnd,
            blockAllDay: state.blockAllDay,
          })
        : state.demoBusy;
    state.plan = planSchedule({ tasks: planTasks(), busy, settings: state.settings, now });
    state.planBusy = busy;
    state.planWritten = false;
    state.tab = 'plan';
    render();
  });
}

async function addPlanToCalendar() {
  if (state.mode !== 'google') {
    toast('Demo mode: connect Google to add blocks to your calendar.');
    return;
  }
  const blocks = state.plan?.blocks || [];
  if (!blocks.length) return;
  await withStatus('Adding study blocks…', async () => {
    const removed = await clearCalendyBlocks(Date.now());
    await writeBlocks(blocks, { onProgress: (n, total) => setStatus(`Adding study blocks… ${n}/${total}`) });
    state.planWritten = true;
    render();
    toast(`Added ${blocks.length} study blocks${removed ? ` (replaced ${removed} old ones)` : ''}.`);
  });
}

async function removePlanFromCalendar() {
  await withStatus('Removing Calendy blocks…', async () => {
    const removed = await clearCalendyBlocks(Date.now());
    state.planWritten = false;
    render();
    toast(removed ? `Removed ${removed} study blocks from your calendar.` : 'No Calendy blocks to remove.');
  });
}

// ---------- downloads ----------

async function download(id) {
  const a = state.assignments.find((x) => x.id === id);
  if (!a) return;
  if (state.mode !== 'google') {
    toast('Demo mode: connect Google to download assignment files.');
    return;
  }
  await withStatus(`Downloading ${a.title}…`, async () => {
    const r = await downloadAssignment(a, { onStatus: setStatus });
    toast(
      `Saved ${r.saved.length} file${r.saved.length === 1 ? '' : 's'} to Downloads/${r.folder}` +
        (r.problems.length ? ` · ${r.problems.length} couldn't be downloaded (see _assignment.html)` : ''),
    );
  });
}

async function downloadAll() {
  if (state.mode !== 'google') {
    toast('Demo mode: connect Google to download assignment files.');
    return;
  }
  const list = state.assignments.filter((a) => !a.done && !skipped(a) && (!a.due || a.due > Date.now()));
  await withStatus('Downloading assignments…', async () => {
    let files = 0;
    for (const [i, a] of list.entries()) {
      setStatus(`(${i + 1}/${list.length}) ${a.title}`);
      const r = await downloadAssignment(a, { onStatus: (t) => setStatus(`(${i + 1}/${list.length}) ${t}`) });
      files += r.saved.length;
    }
    toast(`Downloaded ${files} files for ${list.length} assignments into Downloads/Calendy.`);
  });
}

// ---------- rendering ----------

function render() {
  document.getElementById('tabs').hidden = !state.mode;
  document.getElementById('refresh').hidden = state.mode !== 'google';
  document.getElementById('subtitle').textContent =
    state.mode === 'demo' ? 'Demo mode · sample data' : state.mode === 'google' ? 'Connected to Google' : 'Your study planner';
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === state.tab);

  if (!state.mode) view.innerHTML = renderWelcome();
  else if (state.tab === 'assignments') view.innerHTML = renderAssignments();
  else if (state.tab === 'plan') view.innerHTML = renderPlan();
  else view.innerHTML = renderSettings();
}

function renderWelcome() {
  return `<section class="welcome">
    <h1>Plan your week around real life</h1>
    <p>Calendy reads your Google Classroom, works around everything already on your calendar, and schedules study time before each deadline.</p>
    <button class="btn primary block" data-action="connect">Connect Google account</button>
    <button class="btn block" data-action="demo">Try it with sample data</button>
    <ul class="features">
      <li><b>Google Classroom</b><span>Every assignment, due date and whether you've turned it in.</span></li>
      <li><b>Organized downloads</b><span>Files go into Downloads/Calendy/Class/Assignment, including files linked inside Google Sheets.</span></li>
      <li><b>Smart planning</b><span>Splits big work across days, respects your hours and daily limit, and never double-books you.</span></li>
      <li><b>Google Calendar</b><span>Adds study blocks to your calendar, and replaces them when you re-plan.</span></li>
    </ul>
  </section>`;
}

function taskItem(a, now) {
  const overdue = !a.done && a.due && a.due < now;
  const badges = [
    overdue && '<span class="badge warn">Missing</span>',
    a.kind === 'study' && '<span class="badge">Study</span>',
    a.materials.length && `<span class="muted">· ${a.materials.length} file${a.materials.length === 1 ? '' : 's'}</span>`,
  ]
    .filter(Boolean)
    .join(' ');
  const title = a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title);
  return `<li class="task${skipped(a) ? ' skipped' : ''}" data-id="${esc(a.id)}">
    <span class="dot" style="--c:${courseColor(a.courseId)}"></span>
    <div class="task-main">
      <div class="task-title">${title}</div>
      <div class="task-meta">${esc(a.courseName)} · ${esc(fmtDue(a.due))} ${badges}</div>
    </div>
    <label class="est" title="How long you think it'll take (minutes)">
      <input type="number" min="0" step="15" value="${minutesFor(a)}" data-action="minutes" aria-label="Minutes" />m
    </label>
    <button class="icon-btn" data-action="download" title="Download files into an organized folder">⤓</button>
    <input type="checkbox" data-action="include" ${skipped(a) ? '' : 'checked'} title="Include in plan" aria-label="Include in plan" />
  </li>`;
}

function renderAssignments() {
  const now = Date.now();
  const open = state.assignments.filter((a) => !a.done);
  const week = addDays(startOfDay(now), 8);
  const groups = [
    ['Missing', open.filter((a) => a.due && a.due < now && a.due > now - 30 * 24 * 60 * MIN)],
    ['Due this week', open.filter((a) => a.due && a.due >= now && a.due < week)],
    ['Later', open.filter((a) => a.due && a.due >= week)],
    ['No due date', open.filter((a) => !a.due)],
  ].filter(([, list]) => list.length);
  for (const [, list] of groups) list.sort((a, b) => (a.due || 0) - (b.due || 0));

  const done = state.assignments.length - open.length;
  if (!groups.length) {
    return `<div class="empty">Nothing due. 🎉<br><span class="small">${done} assignment${done === 1 ? '' : 's'} already turned in.</span></div>`;
  }
  const upcomingMinutes = open
    .filter((a) => a.due && a.due >= now && !skipped(a))
    .reduce((sum, a) => sum + minutesFor(a), 0);

  return `<div class="row wrap" style="margin-bottom:10px">
      <span class="muted small">${fmtMinutes(upcomingMinutes)} of work coming up · ${done} turned in</span>
      <span class="spacer"></span>
      <button class="btn" data-action="download-all" title="Download every upcoming assignment">⤓ All</button>
      <button class="btn primary" data-action="plan">Plan my week</button>
    </div>
    ${groups
      .map(([name, list]) => `<div class="section-title">${name}</div><ul class="tasks">${list.map((a) => taskItem(a, now)).join('')}</ul>`)
      .join('')}
    <p class="muted small" style="margin:14px 4px 0">Times are guesses. Change the minutes to match how long things really take you, or untick something to leave it out of the plan.</p>`;
}

function renderPlan() {
  const plan = state.plan;
  if (!plan) {
    return `<div class="card empty">
      <p>Calendy will look at your calendar for the next ${state.settings.horizonDays} days and fit study time around it.</p>
      <button class="btn primary" data-action="plan">Make my plan</button>
    </div>`;
  }

  const total = plan.blocks.reduce((s, b) => s + (b.end - b.start) / MIN, 0);
  const days = new Set(plan.blocks.map((b) => dayKey(b.start)));
  const problems = plan.unscheduled.filter((u) => u.reason !== 'beyond-horizon');
  const later = plan.unscheduled.filter((u) => u.reason === 'beyond-horizon');

  let html = `<div class="summary">
    <div class="stat"><b>${plan.blocks.length}</b><span>study blocks</span></div>
    <div class="stat"><b>${fmtMinutes(total)}</b><span>planned</span></div>
    <div class="stat"><b>${days.size}</b><span>days</span></div>
  </div>`;

  if (problems.length) {
    html += `<div class="warning"><b>Not enough free time for everything:</b><ul>${problems
      .map(
        (u) =>
          `<li>${esc(u.title)}: ${fmtMinutes(u.remainingMinutes)} short${
            u.reason === 'too-soon' ? ' (due too soon to plan)' : ''
          }</li>`,
      )
      .join('')}</ul><span class="small">Try a higher daily limit or longer study hours in Settings, or lower the time estimates.</span></div>`;
  }

  html += `<div class="row wrap" style="margin-bottom:12px">
    <button class="btn primary" data-action="write" ${plan.blocks.length ? '' : 'disabled'}>${
      state.planWritten ? '✓ On your calendar' : 'Add to Google Calendar'
    }</button>
    <button class="btn" data-action="plan">Re-plan</button>
    ${state.mode === 'google' ? '<button class="btn" data-action="unwrite" title="Remove Calendy study blocks from your calendar">Remove blocks</button>' : ''}
  </div>
  <div class="legend"><span><i style="background:var(--accent)"></i>Study block</span><span><i style="background:var(--event)"></i>Already on your calendar</span></div>`;

  if (!plan.blocks.length) {
    html += `<div class="empty">No study blocks needed${later.length ? ' yet' : ''}.</div>`;
  }

  // One section per day that has study blocks, with that day's existing events alongside.
  for (let d = startOfDay(plan.range.start); d <= plan.range.end; d = addDays(d, 1)) {
    const key = dayKey(d);
    const blocks = plan.blocks.filter((b) => dayKey(b.start) === key);
    if (!blocks.length) continue;
    const dayEnd = addDays(d, 1);
    const events = state.planBusy.filter((e) => e.start < dayEnd && e.end > d && !e.allDay);
    const items = [
      ...events.map((e) => ({ type: 'event', start: Math.max(e.start, d), end: Math.min(e.end, dayEnd), e })),
      ...blocks.map((b) => ({ type: 'study', start: b.start, end: b.end, b })),
    ].sort((x, y) => x.start - y.start);
    const studied = blocks.reduce((s, b) => s + (b.end - b.start) / MIN, 0);

    html += `<section class="day"><h3>${esc(relDay(d) === dayFmt.format(d) ? longDayFmt.format(d) : `${relDay(d)} · ${dayFmt.format(d)}`)}<span>${fmtMinutes(studied)} studying</span></h3>
      ${items
        .map((it) =>
          it.type === 'event'
            ? `<div class="slot event"><time>${timeFmt.format(it.start)}</time><div class="box"><b>${esc(it.e.title)}</b><small>until ${timeFmt.format(it.end)}</small></div></div>`
            : `<div class="slot study" style="--c:${courseColor(it.b.courseId)}"><time>${timeFmt.format(it.start)}</time><div class="box"><b>${esc(it.b.title)}</b><small>${fmtMinutes((it.end - it.start) / MIN)} · ${esc(it.b.courseName)} · due ${esc(relDay(it.b.due))}</small></div></div>`,
        )
        .join('')}
    </section>`;
  }

  if (later.length) {
    html += `<p class="muted small" style="margin:4px">${later.length} assignment${later.length === 1 ? ' is' : 's are'} due after the next ${state.settings.horizonDays} days and will be planned closer to the date.</p>`;
  }
  return html;
}

function renderSettings() {
  const s = state.settings;
  const num = (path, label, value, min, max, step = 5) =>
    `<div class="field"><label for="${path}">${label}</label><input id="${path}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-setting="${path}" /></div>`;
  const hours = (key, label) =>
    `<div class="field"><label>${label}</label><div class="times">
      <input type="time" value="${s[key].start}" data-setting="${key}.start" aria-label="${label} start" />–
      <input type="time" value="${s[key].end}" data-setting="${key}.end" aria-label="${label} end" />
      <input type="checkbox" ${s[key].off ? '' : 'checked'} data-setting="${key}.on" title="Study on these days" aria-label="Study on ${label}" />
    </div></div>`;

  return `<div class="section-title">When you study</div>
    <div class="card">
      ${hours('weekday', 'School days')}
      ${hours('weekend', 'Weekends')}
      ${num('maxMinutesPerDay', 'Most study time per day (min)', s.maxMinutesPerDay, 30, 720, 15)}
    </div>
    <div class="section-title">Study blocks</div>
    <div class="card">
      ${num('blockMinutes', 'Block length (min)', s.blockMinutes, 15, 180)}
      ${num('breakMinutes', 'Break between blocks (min)', s.breakMinutes, 0, 60)}
      ${num('bufferMinutes', 'Gap around other events (min)', s.bufferMinutes, 0, 60)}
      ${num('finishBeforeDueHours', 'Finish this many hours early', Math.round(s.finishBeforeDueMinutes / 60), 0, 72, 1)}
      ${num('horizonDays', 'Plan this many days ahead', s.horizonDays, 1, 30, 1)}
    </div>
    ${
      state.mode === 'google'
        ? `<div class="section-title">Work around events from</div>
    <div class="card">
      ${state.calendars
        .map(
          (c) =>
            `<div class="field"><label><span class="dot" style="--c:${esc(c.color || '#888')};display:inline-block;margin-right:6px"></span>${esc(c.name)}</label><input type="checkbox" data-calendar="${esc(c.id)}" ${
              state.calendarIds?.includes(c.id) ? 'checked' : ''
            } /></div>`,
        )
        .join('')}
      <div class="field"><label>All-day events block the whole day</label><input type="checkbox" data-setting="blockAllDay" ${state.blockAllDay ? 'checked' : ''} /></div>
    </div>`
        : ''
    }
    <div class="section-title">Account</div>
    <div class="card row wrap">
      ${
        state.mode === 'google'
          ? '<button class="btn" data-action="leave">Sign out</button>'
          : '<button class="btn primary" data-action="connect">Connect Google</button><button class="btn" data-action="leave">Exit demo</button>'
      }
    </div>`;
}

// ---------- events ----------

document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) {
    state.tab = tab;
    render();
  }
});

document.getElementById('refresh').addEventListener('click', () => withStatus('Refreshing…', refreshGoogle));

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const id = el.closest('[data-id]')?.dataset.id;
  const actions = {
    connect: connectGoogle,
    demo: startDemo,
    leave,
    plan: makePlan,
    write: addPlanToCalendar,
    unwrite: removePlanFromCalendar,
    download: () => download(id),
    'download-all': downloadAll,
  };
  actions[el.dataset.action]?.();
});

view.addEventListener('change', (e) => {
  const el = e.target;
  const id = el.closest('[data-id]')?.dataset.id;

  if (el.dataset.action === 'minutes' && id) {
    state.overrides[id] = { ...state.overrides[id], minutes: Math.max(0, Number(el.value) || 0) };
    save('overrides', state.overrides);
    state.plan = null;
    return;
  }
  if (el.dataset.action === 'include' && id) {
    state.overrides[id] = { ...state.overrides[id], skip: !el.checked };
    save('overrides', state.overrides);
    el.closest('.task').classList.toggle('skipped', !el.checked);
    state.plan = null;
    return;
  }
  if (el.dataset.calendar) {
    const ids = new Set(state.calendarIds || []);
    el.checked ? ids.add(el.dataset.calendar) : ids.delete(el.dataset.calendar);
    state.calendarIds = [...ids];
    save('calendarIds', state.calendarIds);
    state.plan = null;
    return;
  }

  const path = el.dataset.setting;
  if (!path) return;
  const s = structuredClone(state.settings);
  if (path === 'blockAllDay') {
    state.blockAllDay = el.checked;
    save('blockAllDay', state.blockAllDay);
  } else if (path.endsWith('.on')) {
    s[path.split('.')[0]].off = !el.checked;
  } else if (path.includes('.')) {
    const [group, key] = path.split('.');
    if (el.value) s[group][key] = el.value;
  } else if (path === 'finishBeforeDueHours') {
    s.finishBeforeDueMinutes = Math.max(0, Number(el.value) || 0) * 60;
  } else {
    const n = Number(el.value);
    if (Number.isFinite(n) && n >= 0) s[path] = n;
  }
  state.settings = mergeSettings(s);
  save('settings', state.settings);
  state.plan = null;
});

// ---------- start ----------

(async function init() {
  state.settings = mergeSettings(await load('settings', {}));
  state.overrides = await load('overrides', {});
  state.calendarIds = await load('calendarIds', null);
  state.blockAllDay = await load('blockAllDay', false);
  const mode = await load('mode', null);

  if (mode === 'demo' || (!inExtension && new URLSearchParams(location.search).has('demo'))) {
    startDemo();
    return;
  }
  if (mode === 'google' && inExtension) {
    try {
      await getToken(false); // silent: only works if already signed in
      state.mode = 'google';
      render();
      await withStatus('Loading…', refreshGoogle);
      return;
    } catch {
      // Not signed in any more; fall through to the welcome screen.
    }
  }
  render();
})();
