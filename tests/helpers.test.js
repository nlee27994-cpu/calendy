process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveIdFromUrl, extractUrls, safeName, assignmentFolder, isDriveFolderUrl } from '../extension/lib/links.js';
import { dueDateOf, estimateMinutes, kindOf, normalizeCourseWork } from '../extension/lib/assignments.js';

test('driveIdFromUrl handles Docs, Sheets, Drive and open?id= links', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(driveIdFromUrl(`https://docs.google.com/document/d/${id}/edit?usp=sharing`), id);
  assert.equal(driveIdFromUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(driveIdFromUrl(`https://drive.google.com/file/d/${id}/view`), id);
  assert.equal(driveIdFromUrl(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveIdFromUrl('https://example.com/d/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(driveIdFromUrl('not a url'), null);
});

test('isDriveFolderUrl', () => {
  assert.ok(isDriveFolderUrl('https://drive.google.com/drive/folders/abc123'));
  assert.ok(isDriveFolderUrl('https://drive.google.com/drive/u/0/folders/abc123'));
  assert.ok(!isDriveFolderUrl('https://drive.google.com/file/d/abc123/view'));
});

test('extractUrls finds links in text and trims punctuation', () => {
  assert.deepEqual(extractUrls('See https://a.com/x. Also (https://b.org/y) and https://a.com/x'), [
    'https://a.com/x',
    'https://b.org/y',
  ]);
});

test('safeName removes characters that break file systems', () => {
  assert.equal(safeName('Unit 3: Cells / Organelles?'), 'Unit 3_ Cells _ Organelles_');
  assert.equal(safeName('...'), 'untitled');
  assert.equal(safeName('CON'), '_CON');
});

test('assignmentFolder groups by class and due date', () => {
  const due = new Date(2026, 10, 12, 23, 59).getTime();
  assert.equal(
    assignmentFolder({ courseName: 'AP Bio', title: 'Lab: Osmosis', due }),
    'Calendy/AP Bio/2026-11-12 Lab_ Osmosis',
  );
});

test('dueDateOf: dueTime is UTC; missing dueTime means 11:59 PM local', () => {
  assert.equal(
    dueDateOf({ dueDate: { year: 2026, month: 11, day: 12 }, dueTime: { hours: 4, minutes: 59 } }),
    Date.UTC(2026, 10, 12, 4, 59),
  );
  assert.equal(dueDateOf({ dueDate: { year: 2026, month: 11, day: 12 }, dueTime: {} }), Date.UTC(2026, 10, 12));
  assert.equal(dueDateOf({ dueDate: { year: 2026, month: 11, day: 12 } }), new Date(2026, 10, 12, 23, 59).getTime());
  assert.equal(dueDateOf({}), null);
});

test('kindOf and estimateMinutes', () => {
  assert.equal(kindOf('Unit 3 Test'), 'study');
  assert.equal(kindOf('Persuasive Essay draft'), 'essay');
  assert.equal(kindOf('Worksheet 4.2'), 'homework');
  assert.equal(estimateMinutes({ title: 'Quiz 2' }), 60);
  assert.equal(estimateMinutes({ title: 'Worksheet', workType: 'SHORT_ANSWER_QUESTION' }), 15);
  assert.ok(estimateMinutes({ title: 'Final Project', maxPoints: 200 }) > estimateMinutes({ title: 'Final Project' }));
});

test('normalizeCourseWork marks turned-in work as done and keeps materials', () => {
  const a = normalizeCourseWork(
    {
      id: 'w1',
      title: 'Reading Ch. 5',
      dueDate: { year: 2026, month: 11, day: 12 },
      materials: [
        { driveFile: { driveFile: { id: 'f1', title: 'Packet', alternateLink: 'https://drive.google.com/file/d/f1' } } },
        { link: { url: 'https://khanacademy.org', title: 'Khan' } },
      ],
    },
    { id: 'c1', name: 'History' },
    { state: 'TURNED_IN' },
  );
  assert.equal(a.id, 'c1:w1');
  assert.equal(a.done, true);
  assert.equal(a.kind, 'reading');
  assert.deepEqual(a.materials.map((m) => m.type), ['drive', 'link']);
});
