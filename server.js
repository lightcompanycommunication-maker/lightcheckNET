const express  = require('express');
const https    = require('https');
const querystring = require('querystring');
const path = require('path');
// ── AWS Rekognition (remplacement temporaire de Face++) ──
const { RekognitionClient, CompareFacesCommand, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const app = express();

app.use(express.json({ limit: '10mb' }));

// Serve static files with .html extension fallback
app.use(express.static('.', { extensions: ['html'] }));

// Explicit routes for each page (handles /attend, /admin, /index)
app.get('/attend',   (req, res) => res.sendFile(path.join(__dirname, 'attend.html')));
app.get('/admin',    (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/index',    (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/rapports', (req, res) => res.sendFile(path.join(__dirname, 'rapports.html')));
app.get('/users',    (req, res) => res.sendFile(path.join(__dirname, 'users.html')));
app.get('/groups',    (req, res) => res.sendFile(path.join(__dirname, 'groups.html')));
app.get('/schedules',    (req, res) => res.sendFile(path.join(__dirname, 'schedules.html')));
app.get('/appointments',(req, res) => res.sendFile(path.join(__dirname, 'appointments.html')));
app.get('/settings',    (req, res) => res.sendFile(path.join(__dirname, 'settings.html')));
app.get('/conges',      (req, res) => res.sendFile(path.join(__dirname, 'conges.html')));
app.get('/',            (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Generic HTTPS POST helper (uses built-in https module) ──
function httpsPost(hostname, urlPath, body, extraHeaders={}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders
      }
    };
    const req = https.request(options, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ statusCode: r.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const FACEPP_HOSTS = ['api-us.faceplusplus.com', 'api-cn.faceplusplus.com'];
// Cache the working host per api_key to avoid retrying every time
const hostCache = {};

function faceppRequestHost(hostname, path, params) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(params);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Réponse Face++ invalide')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function faceppRequest(path, params) {
  const cacheKey = params.api_key || 'default';

  // Use cached host if available
  if (hostCache[cacheKey]) {
    return faceppRequestHost(hostCache[cacheKey], path, params);
  }

  // Try US first, then CN — auto-detect the right region for these keys
  for (const host of FACEPP_HOSTS) {
    const result = await faceppRequestHost(host, path, params);
    if (result.error_message && result.error_message.includes('AUTHENTICATION_ERROR')) {
      console.log(`[Face++] ${host} → AUTHENTICATION_ERROR, trying next host…`);
      continue;
    }
    // This host works — cache it
    hostCache[cacheKey] = host;
    console.log(`[Face++] Using host: ${host}`);
    return result;
  }

  // Both failed — return the last error
  hostCache[cacheKey] = FACEPP_HOSTS[0];
  return faceppRequestHost(FACEPP_HOSTS[0], path, params);
}

app.post('/api/detect', async (req, res) => {
  try {
    const { api_key, api_secret, image_base64 } = req.body;
    if (!api_key || !api_secret || !image_base64) {
      return res.status(400).json({ error: 'Paramètres manquants.' });
    }
    const result = await faceppRequest('/facepp/v3/detect', {
      api_key, api_secret, image_base64, return_attributes: 'none'
    });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/compare', async (req, res) => {
  try {
    const { api_key, api_secret, face_token1, face_token2 } = req.body;
    if (!api_key || !api_secret || !face_token1 || !face_token2) {
      return res.status(400).json({ error: 'Paramètres manquants.' });
    }
    const result = await faceppRequest('/facepp/v3/compare', {
      api_key, api_secret, face_token1, face_token2
    });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  AWS REKOGNITION — remplacement temporaire de Face++ pour la reconnaissance
//  Identifiants lus depuis les variables d'environnement (jamais côté client) :
//    REKO_ACCESS_KEY_ID, REKO_SECRET_ACCESS_KEY, REKO_REGION (def. us-east-1)
//  Permissions IAM requises : rekognition:CompareFaces, rekognition:DetectFaces
// ════════════════════════════════════════════════════════════════════════════
let _rekClient = null;
function getRekognition() {
  if (!_rekClient) {
    const region = process.env.REKO_REGION || process.env.AWS_REGION || 'us-east-1';
    const id     = process.env.REKO_ACCESS_KEY_ID     || process.env.AWS_ACCESS_KEY_ID;
    const secret = process.env.REKO_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    _rekClient = new RekognitionClient({
      region,
      ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {})
    });
  }
  return _rekClient;
}

function b64ToBuffer(s) {
  if (!s) return null;
  return Buffer.from(String(s).replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

// Inscription : on vérifie qu'un seul visage exploitable est présent.
// La référence (image) est stockée côté app dans employees.face_ref.
app.post('/api/face/enroll', async (req, res) => {
  try {
    const buf = b64ToBuffer(req.body.image_base64);
    if (!buf) return res.json({ ok: false, error: 'Image manquante.' });
    const out = await getRekognition().send(new DetectFacesCommand({
      Image: { Bytes: buf }, Attributes: ['DEFAULT']
    }));
    const faces = out.FaceDetails || [];
    if (faces.length === 0)
      return res.json({ ok: false, error: 'Aucun visage détecté. Reprenez la photo dans un endroit plus lumineux.' });
    if (faces.length > 1)
      return res.json({ ok: false, error: 'Plusieurs visages détectés. Cadrez une seule personne.' });
    return res.json({ ok: true, confidence: faces[0].Confidence });
  } catch (e) {
    return res.json({ ok: false, error: 'Erreur Rekognition : ' + (e.message || e.name) });
  }
});

// Vérification : compare le visage de référence (source) à la capture live (target).
// Le seuil métier est appliqué côté application (on renvoie le meilleur score brut).
app.post('/api/face/verify', async (req, res) => {
  try {
    const src = b64ToBuffer(req.body.source_base64); // référence enregistrée
    const tgt = b64ToBuffer(req.body.target_base64); // capture en direct
    if (!src || !tgt) return res.json({ confidence: 0, error: 'Image source ou cible manquante.' });
    const out = await getRekognition().send(new CompareFacesCommand({
      SourceImage: { Bytes: src },
      TargetImage: { Bytes: tgt },
      SimilarityThreshold: 1
    }));
    const matches = out.FaceMatches || [];
    return res.json({ confidence: matches.length ? matches[0].Similarity : 0, matched: matches.length > 0 });
  } catch (e) {
    // Rekognition lève une erreur si aucun visage n'est trouvé dans une image
    if (/InvalidParameter/i.test(e.name || ''))
      return res.json({ confidence: 0, error: 'Aucun visage détecté — repositionnez-vous face à la caméra.' });
    return res.json({ confidence: 0, error: 'Erreur Rekognition : ' + (e.message || e.name) });
  }
});

// ── DB INIT — crée la table appointments dans Supabase via pg ──
app.post('/api/init-appointments', async (req, res) => {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_PROJECT = 'cokuyebjlkuolwpwizko';

  if(!serviceKey){
    return res.status(400).json({
      ok: false,
      error: 'SUPABASE_SERVICE_KEY non configurée.'
    });
  }

  const sql = `
CREATE TABLE IF NOT EXISTS appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name     text NOT NULL,
  visitor_email    text,
  visitor_phone    text,
  project          text NOT NULL,
  notes            text,
  status           text NOT NULL DEFAULT 'planifié'
                     CHECK (status IN ('planifié','confirmé','annulé','terminé')),
  employee_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  appointment_date timestamptz NOT NULL,
  appointment_end  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_date_idx     ON appointments (appointment_date);
CREATE INDEX IF NOT EXISTS appointments_status_idx   ON appointments (status);
CREATE INDEX IF NOT EXISTS appointments_employee_idx ON appointments (employee_id);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='appointments' AND policyname='anon_read') THEN
    CREATE POLICY anon_read  ON appointments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='appointments' AND policyname='anon_write') THEN
    CREATE POLICY anon_write ON appointments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;`;

  try{
    const { Client } = require('pg');
    // Supabase direct Postgres connection (port 5432, SSL required)
    const client = new Client({
      host: `aws-0-eu-west-3.pooler.supabase.com`,
      port: 6543,
      database: 'postgres',
      user: `postgres.${SUPABASE_PROJECT}`,
      password: serviceKey,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    await client.query(sql);
    await client.end();
    res.json({ ok: true, message: 'Table appointments créée avec succès.' });
  }catch(e){
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── MIGRATION STATUS ──
app.get('/api/init-appointments', (req, res) => {
  res.json({
    endpoint: 'POST /api/init-appointments',
    requires: 'SUPABASE_SERVICE_KEY secret',
    configured: !!process.env.SUPABASE_SERVICE_KEY,
    sqlFile: 'migrations/appointments.sql'
  });
});

// ── GESTION DU PERSONNEL (RBAC) ──
// Création/gestion sécurisée des comptes RH & managers (clé service_role côté serveur uniquement).
const { handleStaffAdmin } = require('./staff-admin-core');
app.post('/api/staff', async (req, res) => {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  try {
    const out = await handleStaffAdmin({ body: req.body, authToken: token });
    res.status(out.status).json(out.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✓ Light Check running on port ${PORT}`));
