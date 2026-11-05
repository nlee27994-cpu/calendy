// Downloads an assignment's files into an organized folder:
//
//   Downloads/Calendy/<Course>/<YYYY-MM-DD Title>/
//     _assignment.html     instructions, due date and every link (clickable)
//     <attached files>     Docs/Slides as PDF, Sheets as .xlsx, other files as-is
//     linked/<files>       Drive files linked from inside attached Google Sheets

import { fetchDriveFile, extractSheetLinks, SHEET_MIME } from './drive.js';
import { assignmentFolder, driveIdFromUrl, isDriveFolderUrl, safeName } from './links.js';

const MAX_LINKED_FILES = 30;

async function saveBlob(blob, path) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function summaryHtml(a, saved, links, problems) {
  const li = (items, fn) => (items.length ? `<ul>${items.map((x) => `<li>${fn(x)}</li>`).join('')}</ul>` : '<p>None</p>');
  return `<!doctype html><meta charset="utf-8"><title>${esc(a.title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#1f2330}
h1{font-size:22px;margin:0 0 4px}.meta{color:#5d6475;margin:0 0 20px}h2{font-size:16px;margin:24px 0 6px}
pre{white-space:pre-wrap;font:inherit;background:#f4f5f8;padding:12px;border-radius:8px}a{color:#3b5bdb}</style>
<h1>${esc(a.title)}</h1>
<p class="meta">${esc(a.courseName)} · Due ${a.due ? esc(new Date(a.due).toLocaleString()) : 'no due date'}
${a.url ? ` · <a href="${esc(a.url)}">Open in Classroom</a>` : ''}</p>
<h2>Instructions</h2>${a.description ? `<pre>${esc(a.description)}</pre>` : '<p>None</p>'}
<h2>Files saved in this folder</h2>${li(saved, (f) => esc(f))}
<h2>Links</h2>${li(links, (l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>${l.from ? ` <small>(from ${esc(l.from)})</small>` : ''}`)}
${problems.length ? `<h2>Couldn't download</h2>${li(problems, (p) => esc(p))}` : ''}`;
}

/**
 * Download everything for one assignment. Returns { folder, saved, links, problems }.
 * onStatus(text) is called with progress messages.
 */
export async function downloadAssignment(a, { onStatus = () => {} } = {}) {
  const folder = assignmentFolder(a);
  const saved = [];
  const links = [];
  const problems = [];
  const seenIds = new Set();

  async function saveDrive(id, subdir = '') {
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    try {
      const f = await fetchDriveFile(id);
      if (f.skipped) {
        problems.push(`${f.name}: ${f.skipped}`);
        return f;
      }
      const path = `${folder}/${subdir}${safeName(f.name, 120)}`;
      onStatus(`Saving ${f.name}…`);
      await saveBlob(f.blob, path);
      saved.push(`${subdir}${f.name}`);
      return f;
    } catch (e) {
      problems.push(`${id}: ${e.status === 403 || e.status === 404 ? "you don't have access" : e.message}`);
      return null;
    }
  }

  for (const m of a.materials) {
    if (m.type === 'drive') {
      const f = await saveDrive(m.id);
      if (f?.mimeType === SHEET_MIME) {
        // Follow the links inside the sheet (the "click every link" step).
        onStatus(`Reading links in ${f.name}…`);
        let sheetLinks = [];
        try {
          sheetLinks = await extractSheetLinks(f.id);
        } catch (e) {
          problems.push(`Links in ${f.name}: ${e.message}`);
        }
        let count = 0;
        for (const l of sheetLinks) {
          const id = driveIdFromUrl(l.url);
          if (id && !isDriveFolderUrl(l.url) && count < MAX_LINKED_FILES) {
            count++;
            const got = await saveDrive(id, 'linked/');
            if (!got || got.skipped) links.push({ ...l, from: f.name });
          } else {
            links.push({ ...l, from: f.name });
          }
        }
        if (sheetLinks.length && count >= MAX_LINKED_FILES) {
          problems.push(`Only the first ${MAX_LINKED_FILES} files linked from ${f.name} were downloaded.`);
        }
      }
    } else if (m.type === 'link') {
      const id = driveIdFromUrl(m.url);
      if (id && !isDriveFolderUrl(m.url)) await saveDrive(id);
      links.push({ url: m.url, label: m.title });
    }
  }

  onStatus('Writing summary…');
  await saveBlob(new Blob([summaryHtml(a, saved, links, problems)], { type: 'text/html' }), `${folder}/_assignment.html`);
  return { folder, saved, links, problems };
}
