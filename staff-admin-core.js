/* =========================================================
   staff-admin-core.js — Logique sécurisée de gestion du personnel (RBAC)
   Utilisée par server.js (Replit) ET par la fonction Netlify.
   Nécessite la clé service_role côté SERVEUR uniquement :
     SUPABASE_SERVICE_KEY  (ou SUPABASE_SERVICE_ROLE_KEY)
   ========================================================= */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cokuyebjlkuolwpwizko.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function svc(extra) {
  return Object.assign(
    { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
    extra || {}
  );
}

// Identifie l'appelant à partir de son JWT, puis charge sa fiche staff (service_role → ignore la RLS).
async function getRequester(authToken) {
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + authToken }
  });
  if (!ur.ok) return null;
  const user = await ur.json();
  if (!user || !user.id) return null;
  const sr = await fetch(`${SUPABASE_URL}/rest/v1/staff?user_id=eq.${user.id}&select=*`, { headers: svc() });
  const rows = await sr.json();
  const staff = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!staff || staff.active === false) return null;
  return { user, staff };
}

function canCreateRole(me, role) {
  if (me.role === 'patron') return role === 'rh' || role === 'manager';
  if (me.role === 'rh')     return role === 'manager';
  return false;
}
function canManage(me, target) {
  if (!target) return false;
  if (me.role === 'patron') return target.company_id === me.company_id;
  if (me.role === 'rh')     return target.role === 'manager' && target.created_by === me.id;
  return false;
}

async function listManageable(me) {
  let q;
  if (me.role === 'patron') q = `company_id=eq.${me.company_id}&role=in.(rh,manager)&select=*&order=role.asc,full_name.asc`;
  else if (me.role === 'rh') q = `created_by=eq.${me.id}&role=eq.manager&select=*&order=full_name.asc`;
  else return { staff: [] };

  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/staff?${q}`, { headers: svc() })).json();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { staff: [] };

  const ids = list.map(s => s.id);
  const inList = '(' + ids.join(',') + ')';
  const [sites, teams, locs] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/staff_sites?staff_id=in.${inList}&select=staff_id,location_id`, { headers: svc() }).then(r => r.json()).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/staff_teams?staff_id=in.${inList}&select=staff_id,team`, { headers: svc() }).then(r => r.json()).catch(() => []),
    fetch(`${SUPABASE_URL}/rest/v1/locations?select=id,name`, { headers: svc() }).then(r => r.json()).catch(() => [])
  ]);
  const locName = {}; (Array.isArray(locs) ? locs : []).forEach(l => { locName[l.id] = l.name; });
  list.forEach(s => {
    s.site_ids   = (Array.isArray(sites) ? sites : []).filter(x => x.staff_id === s.id).map(x => x.location_id);
    s.site_names = s.site_ids.map(id => locName[id] || '—');
    s.teams      = (Array.isArray(teams) ? teams : []).filter(x => x.staff_id === s.id).map(x => x.team);
  });
  return { staff: list };
}

async function createStaff(me, body) {
  const full_name = (body.full_name || '').trim();
  const email     = (body.email || '').trim().toLowerCase();
  const password  = body.password || '';
  const role      = body.role;
  const site_ids  = Array.isArray(body.site_ids) ? body.site_ids : [];
  const teams     = Array.isArray(body.teams) ? body.teams.map(t => String(t).trim()).filter(Boolean) : [];

  if (!canCreateRole(me, role)) return { status: 403, body: { error: "Votre rôle ne permet pas de créer ce type de compte." } };
  if (!full_name || !email)     return { status: 400, body: { error: 'Nom et e-mail obligatoires.' } };
  if (password.length < 6)      return { status: 400, body: { error: 'Le mot de passe doit faire au moins 6 caractères.' } };

  // 1) Créer le compte Auth (confirmé immédiatement)
  const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: svc(),
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const created = await cr.json();
  if (!cr.ok || !created.id) {
    return { status: 400, body: { error: 'Création du compte impossible : ' + (created.msg || created.error_description || created.error || 'e-mail déjà utilisé ?') } };
  }
  const newUserId = created.id;

  // 2) Insérer la fiche staff
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/staff`, {
    method: 'POST', headers: svc({ Prefer: 'return=representation' }),
    body: JSON.stringify({ user_id: newUserId, company_id: me.company_id, full_name, email, role, created_by: me.id, active: true })
  });
  const insRows = await ins.json();
  const staffRow = Array.isArray(insRows) && insRows[0] ? insRows[0] : null;
  if (!staffRow) {
    // rollback : supprimer le compte Auth orphelin
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${newUserId}`, { method: 'DELETE', headers: svc() }).catch(() => {});
    return { status: 500, body: { error: 'Compte créé mais fiche personnel non enregistrée : ' + (insRows.message || insRows.code || 'erreur') } };
  }

  // 3) Périmètre
  if (role === 'rh' && site_ids.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/staff_sites`, {
      method: 'POST', headers: svc(),
      body: JSON.stringify(site_ids.map(location_id => ({ staff_id: staffRow.id, location_id })))
    }).catch(() => {});
  }
  if (role === 'manager' && teams.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/staff_teams`, {
      method: 'POST', headers: svc(),
      body: JSON.stringify(teams.map(team => ({ staff_id: staffRow.id, team })))
    }).catch(() => {});
  }
  return { status: 200, body: { ok: true, staff: staffRow } };
}

async function loadTarget(id) {
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${id}&select=*`, { headers: svc() })).json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function updateStaff(me, body) {
  const target = await loadTarget(body.id);
  if (!canManage(me, target)) return { status: 403, body: { error: 'Action non autorisée sur ce compte.' } };

  if (typeof body.active === 'boolean') {
    await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${target.id}`, {
      method: 'PATCH', headers: svc(), body: JSON.stringify({ active: body.active })
    });
  }
  if (Array.isArray(body.site_ids) && target.role === 'rh') {
    await fetch(`${SUPABASE_URL}/rest/v1/staff_sites?staff_id=eq.${target.id}`, { method: 'DELETE', headers: svc() });
    if (body.site_ids.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/staff_sites`, {
        method: 'POST', headers: svc(),
        body: JSON.stringify(body.site_ids.map(location_id => ({ staff_id: target.id, location_id })))
      });
    }
  }
  if (Array.isArray(body.teams) && target.role === 'manager') {
    const teams = body.teams.map(t => String(t).trim()).filter(Boolean);
    await fetch(`${SUPABASE_URL}/rest/v1/staff_teams?staff_id=eq.${target.id}`, { method: 'DELETE', headers: svc() });
    if (teams.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/staff_teams`, {
        method: 'POST', headers: svc(),
        body: JSON.stringify(teams.map(team => ({ staff_id: target.id, team })))
      });
    }
  }
  return { status: 200, body: { ok: true } };
}

async function resetPassword(me, body) {
  const target = await loadTarget(body.id);
  if (!canManage(me, target)) return { status: 403, body: { error: 'Action non autorisée sur ce compte.' } };
  if (!body.password || body.password.length < 6) return { status: 400, body: { error: 'Mot de passe trop court (min. 6 caractères).' } };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target.user_id}`, {
    method: 'PUT', headers: svc(), body: JSON.stringify({ password: body.password })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { status: 400, body: { error: 'Échec : ' + (e.msg || e.error || 'inconnu') } }; }
  return { status: 200, body: { ok: true } };
}

async function handleStaffAdmin({ body, authToken }) {
  if (!SERVICE_KEY) return { status: 500, body: { error: 'Serveur non configuré : clé service_role manquante (SUPABASE_SERVICE_KEY).' } };
  if (!authToken)   return { status: 401, body: { error: 'Non authentifié.' } };
  const req = await getRequester(authToken);
  if (!req) return { status: 401, body: { error: 'Session invalide ou compte non autorisé.' } };
  const me = req.staff;
  const action = (body && body.action) || '';
  try {
    if (action === 'list')           return await listManageable(me).then(b => ({ status: 200, body: b }));
    if (action === 'create')         return await createStaff(me, body);
    if (action === 'update')         return await updateStaff(me, body);
    if (action === 'reset_password') return await resetPassword(me, body);
    return { status: 400, body: { error: 'Action inconnue.' } };
  } catch (e) {
    return { status: 500, body: { error: e.message } };
  }
}

module.exports = { handleStaffAdmin };
