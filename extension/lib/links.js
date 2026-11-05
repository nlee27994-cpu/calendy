// Helpers for links and download paths. Pure functions.

/** Pull a Google Drive / Docs / Sheets / Slides file id out of a URL, or null. */
export function driveIdFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)(google\.com)$/.test(u.hostname)) return null;
  if (!/^(docs|drive|sheets|slides)\.google\.com$/.test(u.hostname)) return null;
  const path = u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (path) return path[1];
  const id = u.searchParams.get('id');
  if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return id;
  return null;
}

/** Is this URL a Google Drive folder (which we can't download as one file)? */
export function isDriveFolderUrl(url) {
  return /drive\.google\.com\/(drive\/)?(u\/\d+\/)?folders\//.test(url);
}

/** Find http(s) URLs in a block of text. */
export function extractUrls(text = '') {
  const found = String(text).match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

/** Make a string safe to use as a file or folder name on Windows, macOS and ChromeOS. */
export function safeName(name, max = 80) {
  let s = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > max) s = s.slice(0, max).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s || 'untitled';
}

function ymd(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Folder (relative to the browser's Downloads folder) for an assignment:
 *   Calendy/<Course>/<YYYY-MM-DD> <Assignment title>
 */
export function assignmentFolder(assignment, root = 'Calendy') {
  const date = assignment.due ? ymd(assignment.due) : 'no due date';
  return [safeName(root), safeName(assignment.courseName || 'Other'), safeName(`${date} ${assignment.title}`)].join('/');
}
