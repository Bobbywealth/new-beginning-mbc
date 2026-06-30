/* ==========================================================================
   New Beginning MBC — Dashboard shared JS
   Auth gate + sidebar + role permissions + data store + toast + modals
   ========================================================================== */

/* -------------------------------------------------------------------------- */
/*  AUTH                                                                      */
/* -------------------------------------------------------------------------- */

const DEMO_USERS = {
  'admin@newbeginningmbc.org': { name: 'Sarah Jenkins',  role: 'admin',  password: 'admin123',  perms: ['*'] },
  'pastor@newbeginningmbc.org': { name: 'Pastor Eric Readon', role: 'pastor', password: 'pastor123', perms: ['view_members', 'edit_members', 'view_sms', 'edit_sms', 'send_comms', 'view_comms', 'manage_events', 'manage_sermons', 'view_prayer', 'edit_prayer', 'view_reports'] },
  'staff@newbeginningmbc.org':  { name: 'Marcus Lee',     role: 'staff',  password: 'staff123',  perms: ['view_members', 'view_sms', 'view_comms', 'manage_events', 'manage_sermons', 'view_prayer'] },
};

function getSession() {
  try {
    const raw = localStorage.getItem('nbmc_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() > s.expires) { localStorage.removeItem('nbmc_session'); return null; }
    return s;
  } catch (e) { return null; }
}

function setSession(s) {
  localStorage.setItem('nbmc_session', JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem('nbmc_session');
}

function requireAuth() {
  const s = getSession();
  if (!s) {
    window.location.href = '/login.html';
    return null;
  }
  return s;
}

function logout() {
  clearSession();
  window.location.href = '/login.html';
}

function login(email, password, remember) {
  const user = DEMO_USERS[email.toLowerCase().trim()];
  if (!user || user.password !== password) {
    return { ok: false, error: 'Invalid email or password.' };
  }
  const session = {
    email: email.toLowerCase().trim(),
    name: user.name,
    role: user.role,
    perms: user.perms,
    expires: Date.now() + (remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000),
  };
  setSession(session);
  return { ok: true, session };
}

function hasPerm(perm) {
  const s = getSession();
  if (!s) return false;
  if (s.perms.includes('*')) return true;
  return s.perms.includes(perm);
}

function isRole(...roles) {
  const s = getSession();
  return s && roles.includes(s.role);
}

/* -------------------------------------------------------------------------- */
/*  DATA STORE (API + in-memory cache)                                        */
/* -------------------------------------------------------------------------- */
/* The dashboard now reads/writes through new-beginning-mbc-api (Render).      */
/* An in-memory cache is hydrated on page load so existing synchronous        */
/* store_list() / store_get() call sites keep working unchanged.              */
/* store_add() / store_update() / store_delete() are async (call API + cache).*/

const API_BASE = 'https://new-beginning-mbc-api.onrender.com';
// Shared secret the API requires for write operations. Mirrors the
// ADMIN_TOKEN env var on the new-beginning-mbc-api service. Reads are
// open, so the public site doesn't need this.
const NBMC_ADMIN_TOKEN = 'nbmc-adm-7b8ffe32494939ddcc035e534eb04618a747';
const _cache = new Map();

// Map localStorage-style keys to API endpoints
const KEY_TO_ENDPOINT = {
  members:         '/api/members',
  sms_signups:     '/api/sms-signups',
  events:          '/api/events',
  sermons:         '/api/sermons',
  prayer_requests: '/api/prayer-requests',
  templates:       '/api/templates',
  message_history: '/api/message-history',
  staff:           '/api/staff',
  password_resets: '/api/password-resets',
  // 'settings' is handled separately below (per-key PUT)
};

async function _api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Token is required for writes (POST/PUT/DELETE). The API returns 401
  // if the token is wrong, so the catch surfaces a useful error.
  if (method !== 'GET' && method !== 'HEAD') headers['X-Admin-Token'] = NBMC_ADMIN_TOKEN;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function hydrateStores() {
  // Pull every list endpoint in parallel
  await Promise.all(
    Object.entries(KEY_TO_ENDPOINT).map(async ([key, ep]) => {
      try {
        const data = await _api('GET', ep);
        _cache.set(key, Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn(`[hydrate] ${key}:`, e.message);
        _cache.set(key, _cache.get(key) || []);
      }
    })
  );
  // settings is shaped as rows of {key, value, updated_by, ...}
  try {
    const s = await _api('GET', '/api/settings');
    _cache.set('settings', Array.isArray(s) ? s : []);
  } catch (e) {
    console.warn('[hydrate] settings:', e.message);
    _cache.set('settings', _cache.get('settings') || []);
  }
  // password_resets is now an API-backed resource too
  if (!_cache.has('password_resets')) _cache.set('password_resets', []);

  console.log('[hydrate] stores ready:', Object.fromEntries(
    [..._cache.entries()].map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
  ));
}

// Exposed globally — HTML pages wrap their inline scripts in this
window.storesReady = hydrateStores();

// ---- Sync reads (unchanged call signatures) ----
function store_list(key) {
  return _cache.get(key) || [];
}
function store_get(key, id) {
  return store_list(key).find(x => x.id === id) || null;
}
function store_set(key, list) {
  _cache.set(key, list);
}

// ---- Async writes (call API, then refresh cache) ----
async function store_add(key, item) {
  const ep = KEY_TO_ENDPOINT[key];
  if (ep) {
    const created = await _api('POST', ep, item);
    const list = store_list(key);
    list.unshift(created);
    _cache.set(key, list);
    return created;
  }
  // No local-only fallback: every key is API-backed now.
  throw new Error(`store_add: no endpoint for "${key}"`);
}

async function store_update(key, id, patch) {
  const ep = KEY_TO_ENDPOINT[key];
  if (ep) {
    const updated = await _api('PUT', `${ep}/${encodeURIComponent(id)}`, patch);
    const list = store_list(key);
    const i = list.findIndex(x => x.id === id);
    if (i !== -1) list[i] = updated;
    _cache.set(key, list);
    return updated;
  }
  throw new Error(`store_update: no endpoint for "${key}"`);
}

async function store_delete(key, id) {
  const ep = KEY_TO_ENDPOINT[key];
  if (ep) {
    try { await _api('DELETE', `${ep}/${encodeURIComponent(id)}`); }
    catch (e) { console.warn(`[store_delete] ${key}/${id}:`, e.message); }
  }
  _cache.set(key, store_list(key).filter(x => x.id !== id));
}

/* Seed sample data on first load so the demo doesn't feel empty
   (No-op: data now lives in the API. The DB starts empty. Add real records via the dashboard or POST to the API.) */
function seedIfEmpty() {
  return;
}
function _legacySeedRunOnce() {

  // Members (5 sample)
  store_set('members', [
    { id: 'm1', first_name: 'Janet', last_name: 'Williams', phone: '(305) 555-0142', email: 'janet.w@example.com', address: 'Miami Gardens, FL', birthday: '1985-03-12', membership_status: 'Active Member', ministry_group: 'Women’s Ministry', sms_opt_in: true, tags: ['Women’s Ministry', 'Volunteer'], notes: 'Helps with Sunday setup.', last_contacted: now, created_at: now },
    { id: 'm2', first_name: 'David', last_name: 'Brooks', phone: '(305) 555-0188', email: 'dbrooks@example.com', address: 'Miami Lakes, FL', birthday: '1979-07-25', membership_status: 'Active Member', ministry_group: 'Men’s Ministry', sms_opt_in: true, tags: ['Men’s Ministry', 'Leadership'], notes: 'Usher team lead.', last_contacted: now, created_at: now },
    { id: 'm3', first_name: 'Aaliyah', last_name: 'Thompson', phone: '(305) 555-0213', email: 'aaliyah.t@example.com', address: 'North Miami, FL', birthday: '2007-11-04', membership_status: 'New Member', ministry_group: 'Youth', sms_opt_in: true, tags: ['Youth', 'Worship Team'], notes: 'Joins youth service Fridays.', last_contacted: now, created_at: now },
    { id: 'm4', first_name: 'Marcus', last_name: 'Lee', phone: '(305) 555-0177', email: 'mlee@example.com', address: 'Hialeah, FL', birthday: '1990-01-30', membership_status: 'Active Member', ministry_group: 'Outreach Team', sms_opt_in: true, tags: ['Outreach Team', 'Volunteer'], notes: '', last_contacted: now, created_at: now },
    { id: 'm5', first_name: 'Patricia', last_name: 'Singh', phone: '(305) 555-0099', email: 'psingh@example.com', address: 'Miami Gardens, FL', birthday: '1968-05-18', membership_status: 'Needs Follow-Up', ministry_group: '', sms_opt_in: false, tags: ['Needs Follow-Up'], notes: 'Missed 3 Sundays — pastor to call.', last_contacted: null, created_at: now },
  ]);

  // SMS Sign-ups (3 sample)
  store_set('sms_signups', [
    { id: 's1', first_name: 'Tyra', last_name: 'Brown', phone: '(305) 555-0231', email: '', opt_in_status: 'Opted In', opt_in_date: now, opt_in_source: 'Website Form', consent_text: 'I agree to receive text messages from New Beginning Missionary Baptist Church.', tags: ['Guest'], member_status: 'Guest', notes: '', created_at: now },
    { id: 's2', first_name: 'James', last_name: 'Carter', phone: '(305) 555-0267', email: 'jcarter@example.com', opt_in_status: 'Opted In', opt_in_date: now, opt_in_source: 'Church Service', consent_text: 'I agree to receive text messages from New Beginning Missionary Baptist Church.', tags: [], member_status: 'Guest', notes: '', created_at: now },
    { id: 's3', first_name: 'Linda', last_name: 'Nguyen', phone: '(305) 555-0290', email: 'lnguyen@example.com', opt_in_status: 'Pending', opt_in_date: now, opt_in_source: 'Manual Entry', consent_text: '', tags: [], member_status: 'Guest', notes: 'Awaiting verbal confirmation.', created_at: now },
  ]);

  // Events
  const upcomingDate = (offsetDays) => {
    const d = new Date(today); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10);
  };
  store_set('events', [
    { id: 'e1', title: 'Sunday Worship Service', date: upcomingDate(0), start_time: '10:00', end_time: '12:00', location: 'Main Sanctuary', description: 'Weekly worship, word, and fellowship. All are welcome.', image_url: '', ministry: 'Worship', is_public: true, rsvp_required: false, featured_on_homepage: true, text_reminder_enabled: true, created_at: now },
    { id: 'e2', title: 'Family Fun Day', date: upcomingDate(7), start_time: '12:00', end_time: '16:00', location: 'Church Lawn', description: 'Food, games, and fellowship for the whole family.', image_url: '', ministry: 'Outreach', is_public: true, rsvp_required: false, featured_on_homepage: true, text_reminder_enabled: true, created_at: now },
    { id: 'e3', title: 'Youth Conference', date: upcomingDate(14), start_time: '09:00', end_time: '15:00', location: 'The Event Center', description: 'A full day of worship, teaching, and connection for grades 6–12.', image_url: '', ministry: 'Youth', is_public: true, rsvp_required: true, featured_on_homepage: false, text_reminder_enabled: true, created_at: now },
    { id: 'e4', title: 'Bible Study', date: upcomingDate(2), start_time: '19:00', end_time: '20:30', location: 'Fellowship Hall', description: 'Mid-week study and discussion. Bring your Bible.', image_url: '', ministry: '', is_public: false, rsvp_required: false, featured_on_homepage: false, text_reminder_enabled: false, created_at: now },
  ]);

  // Sermons
  store_set('sermons', [
    { id: 'sm1', title: 'Faith That Moves Mountains', speaker: 'Pastor Eric Readon', date: upcomingDate(-7), scripture: 'Matthew 17:20', youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', audio_link: '', thumbnail_url: '', description: 'When the mountain won’t move, faith calls us to climb. In this message, Pastor Eric Readon explores what it looks like to trust God when circumstances feel impossible — and how prayer becomes our foothold on the way up.', series_name: 'Walk By Faith', featured: true, created_at: now },
    { id: 'sm2', title: 'Walking in Purpose', speaker: 'Pastor Eric Readon', date: upcomingDate(-14), scripture: 'Jeremiah 29:11', youtube_link: '', audio_link: '', thumbnail_url: '', description: 'Discovering God’s unique call on your life.', series_name: 'Walk By Faith', featured: false, created_at: now },
    { id: 'sm3', title: 'The Power of Community', speaker: 'Guest Speaker', date: upcomingDate(-21), scripture: 'Hebrews 10:24-25', youtube_link: '', audio_link: '', thumbnail_url: '', description: 'Why we cannot do faith alone.', series_name: 'Together', featured: false, created_at: now },
  ]);

  // Prayer Requests
  store_set('prayer_requests', [
    { id: 'p1', name: 'Janet Williams', phone: '(305) 555-0142', email: '', request_text: 'Please pray for my mother’s surgery this Thursday. Recovery and peace.', privacy_level: 'public', urgency_level: 'Important', assigned_to: 'Pastor Eric Readon', status: 'Praying', notes: 'Pastor called Tuesday.', created_at: now },
    { id: 'p2', name: 'Anonymous', phone: '', email: '', request_text: 'Prayer for our youth — many are facing decisions about college and career.', privacy_level: 'public', urgency_level: 'Normal', assigned_to: '', status: 'New', notes: '', created_at: now },
    { id: 'p3', name: 'David Brooks', phone: '(305) 555-0188', email: '', request_text: 'Job interview next Monday. Wisdom and favor.', privacy_level: 'private', urgency_level: 'Normal', assigned_to: 'Pastor Eric Readon', status: 'Praying', notes: '', created_at: now },
  ]);

  // Message Templates
  store_set('templates', [
    { id: 't1', title: 'Sunday Service Reminder', category: 'Service Reminders', message_body: 'Good morning New Beginning family! Reminder: Sunday Worship starts at 10:00 AM. We can’t wait to see you. — New Beginning MBC', created_by: 'admin@newbeginningmbc.org', created_at: now },
    { id: 't2', title: 'Bible Study Reminder', category: 'Service Reminders', message_body: 'Reminder: Bible Study is tonight at 7:00 PM. Bring your Bible and invite someone. — New Beginning MBC', created_by: 'admin@newbeginningmbc.org', created_at: now },
    { id: 't3', title: 'Welcome Text', category: 'Welcome', message_body: 'Welcome to New Beginning Missionary Baptist Church! Thank you for joining our text list. We’re excited to stay connected with you. — New Beginning MBC', created_by: 'admin@newbeginningmbc.org', created_at: now },
    { id: 't4', title: 'Prayer Call Reminder', category: 'Prayer Calls', message_body: 'New Beginning family, join us for prayer tonight at [Time]. Let’s come together in faith. — New Beginning MBC', created_by: 'admin@newbeginningmbc.org', created_at: now },
  ]);

  // Message history (a couple of example sent messages)
  store_set('message_history', [
    { id: 'h1', message_body: 'Good morning New Beginning family! Reminder: Sunday Worship starts at 10:00 AM.', recipient_type: 'All SMS Subscribers', recipient_count: 247, sent_at: now, sent_by: 'Pastor Eric Readon', status: 'Delivered' },
    { id: 'h2', message_body: 'Reminder: Bible Study is tonight at 7:00 PM. Bring your Bible and invite someone.', recipient_type: 'All SMS Subscribers', recipient_count: 247, sent_at: now, sent_by: 'Marcus Lee', status: 'Delivered' },
  ]);

  // Staff users (mirrors DEMO_USERS)
  store_set('staff', [
    { id: 'u1', name: 'Sarah Jenkins', email: 'admin@newbeginningmbc.org', phone: '(305) 555-0101', role: 'admin', perms: ['*'], status: 'Active', created_at: now },
    { id: 'u2', name: 'Pastor Eric Readon', email: 'pastor@newbeginningmbc.org', phone: '(305) 555-0102', role: 'pastor', perms: ['view_members', 'edit_members', 'view_sms', 'edit_sms', 'send_comms', 'view_comms', 'manage_events', 'manage_sermons', 'view_prayer', 'edit_prayer', 'view_reports'], status: 'Active', created_at: now },
    { id: 'u3', name: 'Marcus Lee', email: 'staff@newbeginningmbc.org', phone: '(305) 555-0103', role: 'staff', perms: ['view_members', 'view_sms', 'view_comms', 'manage_events', 'manage_sermons', 'view_prayer'], status: 'Active', created_at: now },
  ]);

  // Settings (default values)
  store_set('settings', [
    { id: 's1', key: 'church_name', value: 'New Beginning Missionary Baptist Church', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's2', key: 'address', value: '2801 NW 170th Street, Miami Gardens, FL 33056', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's3', key: 'phone', value: '(555) 123-4567', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's4', key: 'email', value: 'hello@newbeginningmbc.org', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's5', key: 'service_times', value: 'Sun 10:00 AM • Wed Bible Study 7 PM • Thurs Prayer 7 PM • Fri Youth 7 PM', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's6', key: 'twilio_sid', value: '', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's7', key: 'twilio_token', value: '', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's8', key: 'twilio_phone', value: '', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's9', key: 'optin_language', value: 'I agree to receive text messages from New Beginning Missionary Baptist Church. Message & data rates may apply. Reply STOP to unsubscribe.', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
    { id: 's10', key: 'unsubscribe_language', value: 'Reply STOP to unsubscribe. For help, reply HELP.', updated_by: 'admin@newbeginningmbc.org', updated_at: now },
  ]);

  localStorage.setItem('nbmc_seeded_v1', '1');
}
void _legacySeedRunOnce;

/* -------------------------------------------------------------------------- */
/*  SETTINGS helpers                                                          */
/* -------------------------------------------------------------------------- */

function setting_get(key) {
  const list = store_list('settings');
  const row = list.find(s => s.key === key);
  return row ? row.value : '';
}

async function setting_set(key, value, updatedBy) {
  try {
    const updated = await _api('PUT', `/api/settings/${encodeURIComponent(key)}`, {
      value: value ?? '',
      updated_by: updatedBy || 'system',
    });
    const list = store_list('settings');
    const i = list.findIndex(s => s.key === key);
    if (i === -1) list.push(updated);
    else list[i] = updated;
    _cache.set('settings', list);
    return updated;
  } catch (e) {
    console.error('[setting_set]', key, e.message);
    throw e;
  }
}

async function setting_get_async(key) {
  const row = store_list('settings').find(s => s.key === key);
  return row ? row.value : '';
}

/* -------------------------------------------------------------------------- */
/*  TOASTS                                                                    */
/* -------------------------------------------------------------------------- */

function ensureToastWrap() {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

function toast(message, type) {
  const wrap = ensureToastWrap();
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

/* -------------------------------------------------------------------------- */
/*  MODALS                                                                    */
/* -------------------------------------------------------------------------- */

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

/* -------------------------------------------------------------------------- */
/*  SIDEBAR                                                                   */
/* -------------------------------------------------------------------------- */

function renderShell(activeKey) {
  const s = getSession();
  if (!s) return '';
  const initials = s.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const roleColors = { admin: 'var(--yellow)', pastor: 'var(--blue)', staff: 'var(--cream-2)' };
  const roleBg = roleColors[s.role] || 'var(--cream-2)';

  const allItems = [
    { key: 'overview',         label: 'Dashboard Overview', icon: '⌂', href: '/dashboard/index.html', perm: null },
    { key: 'members',          label: 'Members',           icon: '☺', href: '/dashboard/members.html', perm: 'view_members' },
    { key: 'sms',              label: 'SMS Sign-Ups',      icon: '✉', href: '/dashboard/sms-signups.html', perm: 'view_sms' },
    { key: 'comms',            label: 'Communications',    icon: '☏', href: '/dashboard/communications.html', perm: 'view_comms' },
    { key: 'events',           label: 'Events Manager',    icon: '☷', href: '/dashboard/events.html', perm: 'manage_events' },
    { key: 'sermons',          label: 'Sermon Manager',    icon: '▶', href: '/dashboard/sermons.html', perm: 'manage_sermons' },
    { key: 'prayer',           label: 'Prayer Requests',   icon: '♡', href: '/dashboard/prayer-requests.html', perm: 'view_prayer' },
  ];
  const adminItems = [
    { key: 'staff',  label: 'Staff Users', icon: '☰', href: '/dashboard/staff.html', perm: null, admin: true },
    { key: 'settings', label: 'Settings',  icon: '⚙', href: '/dashboard/settings.html', perm: null, admin: true },
  ];

  // Counts for badges
  const smsPending = store_list('sms_signups').filter(s => s.opt_in_status === 'Pending').length;
  const prayerNew  = store_list('prayer_requests').filter(p => p.status === 'New').length;

  const itemHtml = (it) => {
    if (it.admin && s.role !== 'admin') return '';
    if (it.perm && !hasPerm(it.perm)) return '';
    let badge = '';
    if (it.key === 'sms' && smsPending) badge = `<span class="badge">${smsPending}</span>`;
    if (it.key === 'prayer' && prayerNew) badge = `<span class="badge">${prayerNew}</span>`;
    const active = it.key === activeKey ? ' active' : '';
    return `<a class="nav-item${active}" href="${it.href}"><span class="icon">${it.icon}</span><span>${it.label}</span>${badge}</a>`;
  };

  const mainSection = allItems.map(itemHtml).join('');
  const adminSection = adminItems.map(itemHtml).join('');

  return `
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="/dashboard/index.html">
        <img src="/assets/logo.jpg" alt="Logo" />
        <div class="brand-text">
          <strong>NEW BEGINNING</strong>
          <span>CHURCH DASHBOARD</span>
        </div>
      </a>
      <div class="nav-section">Main</div>
      ${mainSection}
      ${adminSection ? `<div class="nav-section">Admin</div>${adminSection}` : ''}
      <div class="sidebar-footer">
        <div class="user-card" onclick="logout()">
          <div class="user-avatar" style="background:${roleBg}">${initials}</div>
          <div class="user-info">
            <strong>${escapeHtml(s.name)}</strong>
            <span>${s.role.toUpperCase()} • LOGOUT</span>
          </div>
        </div>
      </div>
    </aside>
  `;
}

/* -------------------------------------------------------------------------- */
/*  SHELL MOUNT                                                               */
/* -------------------------------------------------------------------------- */

function mountShell(activeKey, breadcrumb) {
  const s = requireAuth();
  if (!s) return null;

  seedIfEmpty();

  // Mount sidebar
  const sidebarHost = document.getElementById('sidebar-host');
  if (sidebarHost) sidebarHost.outerHTML = renderShell(activeKey);

  // Mount mobile bar
  const mobileHost = document.getElementById('mobile-bar-host');
  if (mobileHost) {
    mobileHost.outerHTML = `
      <div class="mobile-bar">
        <button class="menu-btn" onclick="document.getElementById('sidebar').classList.toggle('open')" aria-label="Open menu">☰</button>
        <div class="mobile-bar-brand">
          <img src="/assets/logo.jpg" alt="Logo" />
          <span><strong>NEW BEGINNING</strong> · <em>${escapeHtml(breadcrumb || '')}</em></span>
        </div>
        <button class="menu-btn mobile-bar-logout" onclick="logout()" aria-label="Logout">⎋</button>
      </div>
    `;
  }

  // Set user info in topbar if present
  const userEl = document.getElementById('topbar-user');
  if (userEl) {
    const initials = s.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    userEl.innerHTML = `
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:800;">${escapeHtml(s.name)}</div>
        <div style="font-size:10px;letter-spacing:.18em;color:var(--blue-deep);font-weight:800;">${s.role.toUpperCase()}</div>
      </div>
      <div class="user-avatar" style="background:var(--yellow)">${initials}</div>
    `;
  }

  return s;
}

/* -------------------------------------------------------------------------- */
/*  UTILITIES                                                                 */
/* -------------------------------------------------------------------------- */

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const h12 = hr % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function relTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(iso);
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw;
}

/* -------------------------------------------------------------------------- */
/*  PAGE COMMON                                                               */
/* -------------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('open');
  }
});

// Close sidebar when clicking the dim overlay (the box-shadow on .sidebar.open)
// Click anywhere outside the sidebar while it's open on mobile
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open') && window.innerWidth <= 860) {
    // If click is outside the sidebar element, close it
    if (!sb.contains(e.target)) {
      const isMenuBtn = e.target.classList && (e.target.classList.contains('menu-btn') || e.target.closest('.menu-btn'));
      if (!isMenuBtn) sb.classList.remove('open');
    }
  }
});

// Auto-close sidebar when a nav link is tapped (mobile)
document.addEventListener('click', (e) => {
  const link = e.target.closest && e.target.closest('.sidebar .nav-item');
  if (link) {
    setTimeout(() => {
      const sb = document.getElementById('sidebar');
      if (sb) sb.classList.remove('open');
    }, 50);
  }
});
