// netlify/functions/staff-admin.js
// Équivalent Netlify de POST /api/staff (Replit). Réutilise la logique partagée.
const { handleStaffAdmin } = require('../../staff-admin-core.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non autorisée.' }) };
  }
  const auth  = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  try {
    const out = await handleStaffAdmin({ body, authToken: token });
    return { statusCode: out.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.body) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};