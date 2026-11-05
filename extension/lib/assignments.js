// Turns raw Google Classroom courseWork into Calendy tasks. Pure functions.

const DONE_STATES = new Set(['TURNED_IN', 'RETURNED']);

/**
 * Classroom gives dueDate/dueTime in UTC. If there's no dueTime, treat the
 * assignment as due at 11:59 PM local time on that date.
 */
export function dueDateOf(work) {
  const d = work.dueDate;
  if (!d || !d.year) return null;
  if (work.dueTime) {
    const t = work.dueTime;
    return Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0);
  }
  return new Date(d.year, d.month - 1, d.day, 23, 59).getTime();
}

const STUDY = /\b(test|exam|quiz|midterm|final|assessment)\b/i;
const PROJECT = /\b(project|presentation|portfolio)\b/i;
const ESSAY = /\b(essay|paper|report|research|dbq)\b/i;
const LAB = /\blab\b/i;
const READING = /\b(read|reading|chapter|ch\.)\b/i;

export function kindOf(title = '') {
  if (STUDY.test(title)) return 'study';
  if (PROJECT.test(title)) return 'project';
  if (ESSAY.test(title)) return 'essay';
  if (LAB.test(title)) return 'lab';
  if (READING.test(title)) return 'reading';
  return 'homework';
}

/** Rough guess of how long an assignment takes, in minutes. Users can override it. */
export function estimateMinutes({ title = '', workType, maxPoints } = {}) {
  if (workType === 'MULTIPLE_CHOICE_QUESTION') return 15;
  if (workType === 'SHORT_ANSWER_QUESTION') return 15;
  const base = {
    study: /\bquiz\b/i.test(title) ? 60 : 150,
    project: 180,
    essay: 150,
    lab: 90,
    reading: 45,
    homework: 45,
  }[kindOf(title)];
  const scale = maxPoints >= 100 ? 1.5 : maxPoints && maxPoints <= 10 ? 0.75 : 1;
  return Math.max(15, Math.round((base * scale) / 15) * 15);
}

export function normalizeMaterials(materials = []) {
  const out = [];
  for (const m of materials) {
    if (m.driveFile?.driveFile) {
      const f = m.driveFile.driveFile;
      out.push({ type: 'drive', id: f.id, title: f.title || 'Drive file', url: f.alternateLink });
    } else if (m.link) {
      out.push({ type: 'link', title: m.link.title || m.link.url, url: m.link.url });
    } else if (m.youtubeVideo) {
      out.push({ type: 'link', title: m.youtubeVideo.title || 'YouTube video', url: m.youtubeVideo.alternateLink });
    } else if (m.form) {
      out.push({ type: 'link', title: m.form.title || 'Google Form', url: m.form.formUrl });
    }
  }
  return out;
}

export function normalizeCourseWork(work, course, submission) {
  const state = submission?.state || null;
  return {
    id: `${course.id}:${work.id}`,
    courseId: course.id,
    courseName: course.name,
    title: work.title || 'Untitled assignment',
    description: work.description || '',
    url: work.alternateLink || null,
    due: dueDateOf(work),
    workType: work.workType,
    maxPoints: work.maxPoints,
    state,
    late: !!submission?.late,
    done: DONE_STATES.has(state),
    kind: kindOf(work.title),
    estimatedMinutes: estimateMinutes(work),
    materials: normalizeMaterials(work.materials),
  };
}
