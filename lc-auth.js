/* =========================================================
   lc-auth.js — Authentification & rôles Light Check
   Supabase Auth (e-mail + mot de passe) + session locale.
   Fournit le JWT de l'utilisateur aux appels PostgREST → la RLS s'applique.
   Usage : <script src="lc-auth.js"></script> puis window.LC.*
   ========================================================= */
(function (global) {
  const SUPABASE_URL = window.LC_CONFIG.SUPABASE_URL;
  const ANON_KEY = window.LC_CONFIG.SUPABASE_ANON_KEY;
  const SESSION_KEY = 'lc_staff_session';
  const LOGIN_PAGE = 'login.html';

  // ---- stockage de session ----
  function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function clearSession() { localStorage.removeItem(SESSION_KEY); _staff = null; }

  function buildSession(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
      user: data.user || null
    };
  }

  // ---- connexion / déconnexion ----
  async function login(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      throw new Error(data.error_description || data.msg || data.error || 'Identifiants invalides.');
    }
    const session = buildSession(data);
    saveSession(session);
    _staff = null;
    return session;
  }

  async function refresh() {
    const s = readSession();
    if (!s || !s.refresh_token) return null;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) { clearSession(); return null; }
    const session = buildSession(data);
    saveSession(session);
    return session;
  }

  async function validSession() {
    let s = readSession();
    if (!s || !s.access_token) return null;
    const now = Math.floor(Date.now() / 1000);
    if (s.expires_at && (s.expires_at - now) < 60) {  // proche de l'expiration → on rafraîchit
      s = await refresh();
    }
    return s;
  }

  function token() { const s = readSession(); return s ? s.access_token : null; }

  // En-têtes pour les appels PostgREST : on envoie le JWT de l'utilisateur (→ RLS),
  // ou la clé anon en repli si non connecté.
  function authHeaders(extra) {
    const t = token();
    return Object.assign(
      { apikey: ANON_KEY, Authorization: 'Bearer ' + (t || ANON_KEY) },
      extra || {}
    );
  }

  // Helpers PostgREST prêts à l'emploi (utilisent le JWT).
  async function sbGet(table, query) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query || ''}`, { headers: authHeaders() });
    return r.json();
  }
  async function sbInsert(table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(data)
    });
    return r.json();
  }
  async function sbPatch(table, query, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(data)
    });
    return r.json();
  }
  async function sbDelete(table, query) {
    return fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: authHeaders() });
  }

  // ---- fiche personnel (rôle + périmètre) ----
  let _staff = null;
  async function loadStaff(force) {
    if (_staff && !force) return _staff;
    const s = await validSession();
    if (!s || !s.user) return null;
    const rows = await sbGet('staff', `user_id=eq.${s.user.id}&select=*`);
    _staff = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    if (_staff) {
      const [siteRows, teamRows] = await Promise.all([
        sbGet('staff_sites', `staff_id=eq.${_staff.id}&select=location_id`).catch(() => []),
        sbGet('staff_teams', `staff_id=eq.${_staff.id}&select=team`).catch(() => [])
      ]);
      _staff.site_ids = Array.isArray(siteRows) ? siteRows.map(x => x.location_id) : [];
      _staff.teams = Array.isArray(teamRows) ? teamRows.map(x => x.team) : [];
    }
    return _staff;
  }

  async function logout() {
    try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: authHeaders() }); } catch (e) {}
    clearSession();
  }

  // À appeler en haut d'une page admin. Redirige vers la connexion si non authentifié,
  // ou vers `fallback` si le rôle n'est pas autorisé.
  async function requireAuth(opts) {
    opts = opts || {};
    const s = await validSession();
    if (!s) { location.href = LOGIN_PAGE; return null; }
    const st = await loadStaff();
    if (!st || st.active === false) { clearSession(); location.href = LOGIN_PAGE; return null; }
    if (opts.roles && opts.roles.indexOf(st.role) === -1) {
      alert('Accès non autorisé pour votre rôle.');
      location.href = opts.fallback || 'index.html';
      return null;
    }
    return st;
  }

  global.LC = {
    SUPABASE_URL: SUPABASE_URL,
    ANON_KEY: ANON_KEY,
    LOGIN_PAGE: LOGIN_PAGE,
    login: login,
    logout: logout,
    refresh: refresh,
    validSession: validSession,
    loadStaff: loadStaff,
    requireAuth: requireAuth,
    authHeaders: authHeaders,
    token: token,
    getSession: readSession,
    clearSession: clearSession,
    sbGet: sbGet,
    sbInsert: sbInsert,
    sbPatch: sbPatch,
    sbDelete: sbDelete,
    get staff() { return _staff; },
    get role() { return _staff ? _staff.role : null; },
    get siteIds() { return _staff ? (_staff.site_ids || []) : []; },
    get teams() { return _staff ? (_staff.teams || []) : []; },
    isPatron: function () { return !!_staff && _staff.role === 'patron'; },
    isRH: function () { return !!_staff && _staff.role === 'rh'; },
    isManager: function () { return !!_staff && _staff.role === 'manager'; }
  };
})(window);
