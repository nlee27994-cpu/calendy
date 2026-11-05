// Small key/value store: chrome.storage.local in the extension, localStorage elsewhere
// (so the side panel can also be opened as a plain page for demos).

const hasChrome = typeof chrome !== 'undefined' && chrome.storage?.local;

export async function load(key, fallback) {
  try {
    if (hasChrome) {
      const r = await chrome.storage.local.get(key);
      return r[key] ?? fallback;
    }
    const raw = localStorage.getItem(`calendy:${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  try {
    if (hasChrome) await chrome.storage.local.set({ [key]: value });
    else localStorage.setItem(`calendy:${key}`, JSON.stringify(value));
  } catch {
    // Storage unavailable (private window etc.); settings just won't persist.
  }
}
