// Google sign-in and an authenticated fetch helper.
// Uses chrome.identity, so this only runs inside the Chrome extension.

export async function getToken(interactive = true) {
  const res = await chrome.identity.getAuthToken({ interactive });
  const token = typeof res === 'string' ? res : res?.token;
  if (!token) throw new Error('Google sign-in was cancelled.');
  return token;
}

export async function signOut() {
  try {
    const token = await getToken(false);
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch {
    // Already signed out.
  }
}

export class GoogleApiError extends Error {
  constructor(status, message) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}

/**
 * fetch() a Google API with the user's token.
 * Options: method, body (JSON), query (object; arrays become repeated params), raw (return the Response).
 */
export async function gfetch(url, { method = 'GET', body, query, raw = false } = {}, retry = true) {
  const token = await getToken(true);
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    // Token expired or revoked: drop it and try once more.
    await chrome.identity.removeCachedAuthToken({ token });
    return gfetch(url, { method, body, query, raw }, false);
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error?.message || message;
    } catch {
      // Not JSON.
    }
    throw new GoogleApiError(res.status, message);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Follow nextPageToken until every page of `key` has been collected. */
export async function listAll(url, key, query = {}) {
  const items = [];
  let pageToken;
  do {
    const page = await gfetch(url, { query: { ...query, pageToken } });
    items.push(...(page?.[key] || []));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return items;
}
