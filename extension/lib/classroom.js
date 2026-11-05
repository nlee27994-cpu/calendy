// Google Classroom: your courses, assignments and whether you've turned them in.

import { listAll } from './google.js';
import { normalizeCourseWork } from './assignments.js';

const BASE = 'https://classroom.googleapis.com/v1';

export async function fetchClassroom() {
  const courses = await listAll(`${BASE}/courses`, 'courses', {
    studentId: 'me',
    courseStates: 'ACTIVE',
  });

  const assignments = [];
  const errors = [];
  await Promise.all(
    courses.map(async (course) => {
      try {
        const [work, submissions] = await Promise.all([
          listAll(`${BASE}/courses/${course.id}/courseWork`, 'courseWork', { courseWorkStates: 'PUBLISHED' }),
          listAll(`${BASE}/courses/${course.id}/courseWork/-/studentSubmissions`, 'studentSubmissions', {
            userId: 'me',
          }),
        ]);
        const byWork = new Map(submissions.map((s) => [s.courseWorkId, s]));
        for (const w of work) assignments.push(normalizeCourseWork(w, course, byWork.get(w.id)));
      } catch (e) {
        errors.push(`${course.name}: ${e.message}`);
      }
    }),
  );

  return {
    courses: courses.map((c) => ({ id: c.id, name: c.name, section: c.section || '' })),
    assignments,
    errors,
  };
}
