/* ==========================================================================
   New Beginning MBC — Public site API helper
   The public-facing pages (index, events, sermons, login) read from the
   same Express/Postgres API that the dashboard writes to. Reads are open,
   so no admin token is needed.
   ========================================================================== */
const NBMC_API_BASE = 'https://new-beginning-mbc-api.onrender.com';

async function nbmcFetch(path, opts = {}) {
  const res = await fetch(NBMC_API_BASE + path, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${opts.method || 'GET'} ${path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Convenience getters — return [] or '' on failure so the caller can fall
// back to hardcoded content without try/catch noise.
async function nbmcGetEvents() {
  try { const r = await nbmcFetch('/api/events'); return Array.isArray(r) ? r : []; }
  catch (e) { console.warn('[nbmc] events:', e.message); return []; }
}
async function nbmcGetSermons() {
  try { const r = await nbmcFetch('/api/sermons'); return Array.isArray(r) ? r : []; }
  catch (e) { console.warn('[nbmc] sermons:', e.message); return []; }
}
async function nbmcGetSettings() {
  try { const r = await nbmcFetch('/api/settings'); return Array.isArray(r) ? r : []; }
  catch (e) { console.warn('[nbmc] settings:', e.message); return []; }
}
function nbmcGetSetting(settings, key, fallback = '') {
  const row = (settings || []).find(s => s.key === key);
  return row && row.value ? row.value : fallback;
}

// Public form submissions — no auth required.
async function nbmcSubmitSmsSignup(payload) {
  return nbmcFetch('/api/public/sms-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
async function nbmcRequestPasswordReset(email) {
  return nbmcFetch('/api/public/password-reset-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

window.NBMC = {
  API_BASE: NBMC_API_BASE,
  fetch: nbmcFetch,
  getEvents: nbmcGetEvents,
  getSermons: nbmcGetSermons,
  getSettings: nbmcGetSettings,
  getSetting: nbmcGetSetting,
  submitSmsSignup: nbmcSubmitSmsSignup,
  requestPasswordReset: nbmcRequestPasswordReset,
};
