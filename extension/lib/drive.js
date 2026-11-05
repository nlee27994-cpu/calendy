// Google Drive + Sheets: download files and find the links inside spreadsheets.

import { gfetch, GoogleApiError } from './google.js';
import { extractUrls } from './links.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4';

export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

// Google Docs/Sheets/Slides aren't real files; they have to be exported.
const EXPORTS = {
  'application/vnd.google-apps.document': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.spreadsheet': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsx',
  ],
  'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.drawing': ['image/png', '.png'],
};

export async function getFileMeta(id) {
  return gfetch(`${DRIVE}/files/${id}`, {
    query: { fields: 'id,name,mimeType,shortcutDetails', supportsAllDrives: true },
  });
}

/**
 * Download a Drive file as a Blob.
 * Returns { name, blob, mimeType, id } or { skipped, name, mimeType, id }.
 */
export async function fetchDriveFile(id, depth = 0) {
  const meta = await getFileMeta(id);
  if (meta.mimeType === 'application/vnd.google-apps.shortcut' && meta.shortcutDetails?.targetId && depth < 2) {
    return fetchDriveFile(meta.shortcutDetails.targetId, depth + 1);
  }
  if (meta.mimeType === 'application/vnd.google-apps.folder') {
    return { skipped: 'folder', name: meta.name, mimeType: meta.mimeType, id: meta.id };
  }

  const exp = EXPORTS[meta.mimeType];
  if (!exp && meta.mimeType.startsWith('application/vnd.google-apps.')) {
    return { skipped: 'cannot be downloaded (e.g. a Google Form)', name: meta.name, mimeType: meta.mimeType, id: meta.id };
  }

  const res = exp
    ? await gfetch(`${DRIVE}/files/${meta.id}/export`, { query: { mimeType: exp[0] }, raw: true })
    : await gfetch(`${DRIVE}/files/${meta.id}`, { query: { alt: 'media', supportsAllDrives: true }, raw: true });
  const blob = await res.blob();
  const name = exp ? meta.name.replace(/\.[a-z0-9]{2,5}$/i, '') + exp[1] : meta.name;
  return { name, blob, mimeType: meta.mimeType, id: meta.id };
}

/** Every link in a Google Sheet: hyperlinks, rich-text links, file chips and pasted URLs. */
export async function extractSheetLinks(spreadsheetId) {
  const cell = 'hyperlink,formattedValue,textFormatRuns(format(link(uri)))';
  const withChips = `sheets(properties(title),data(rowData(values(${cell},chipRuns(chip(richLinkProperties(uri)))))))`;
  const basic = `sheets(properties(title),data(rowData(values(${cell}))))`;

  let doc;
  try {
    doc = await gfetch(`${SHEETS}/spreadsheets/${spreadsheetId}`, { query: { includeGridData: true, fields: withChips } });
  } catch (e) {
    // Older API versions reject the smart-chip field; retry without it.
    if (!(e instanceof GoogleApiError) || e.status !== 400) throw e;
    doc = await gfetch(`${SHEETS}/spreadsheets/${spreadsheetId}`, { query: { includeGridData: true, fields: basic } });
  }

  const links = [];
  const seen = new Set();
  const add = (url, label, sheet) => {
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    links.push({ url, label: (label || '').trim() || url, sheet });
  };

  for (const sheet of doc.sheets || []) {
    const title = sheet.properties?.title;
    for (const data of sheet.data || []) {
      for (const row of data.rowData || []) {
        for (const v of row.values || []) {
          const label = v.formattedValue || '';
          add(v.hyperlink, label, title);
          for (const run of v.textFormatRuns || []) add(run.format?.link?.uri, label, title);
          for (const run of v.chipRuns || []) add(run.chip?.richLinkProperties?.uri, label, title);
          for (const u of extractUrls(label)) add(u, label, title);
        }
      }
    }
  }
  return links;
}
