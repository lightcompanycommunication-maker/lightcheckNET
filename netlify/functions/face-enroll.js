// netlify/functions/face-enroll.js
// Validation à l'inscription via AWS Rekognition (DetectFaces) :
// on vérifie qu'un seul visage exploitable est présent. La référence (image)
// est ensuite stockée par l'application dans employees.face_ref.
// Variables d'environnement Netlify requises :
//   REKO_ACCESS_KEY_ID, REKO_SECRET_ACCESS_KEY, REKO_REGION (def. us-east-1)
// Permission IAM : rekognition:DetectFaces
const { RekognitionClient, DetectFacesCommand } = require('@aws-sdk/client-rekognition');

const region = process.env.REKO_REGION || process.env.AWS_REGION || 'us-east-1';
const id     = process.env.REKO_ACCESS_KEY_ID     || process.env.AWS_ACCESS_KEY_ID;
const secret = process.env.REKO_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

const client = new RekognitionClient({
  region,
  ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {})
});

const b64 = (s) => Buffer.from(String(s || '').replace(/^data:image\/\w+;base64,/, ''), 'base64');
const reply = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Méthode non autorisée.' });
  try {
    const { image_base64 } = JSON.parse(event.body || '{}');
    if (!image_base64) return reply(200, { ok: false, error: 'Image manquante.' });
    const out = await client.send(new DetectFacesCommand({
      Image: { Bytes: b64(image_base64) }, Attributes: ['DEFAULT']
    }));
    const faces = out.FaceDetails || [];
    if (faces.length === 0) return reply(200, { ok: false, error: 'Aucun visage détecté. Reprenez la photo dans un endroit plus lumineux.' });
    if (faces.length > 1)  return reply(200, { ok: false, error: 'Plusieurs visages détectés. Cadrez une seule personne.' });
    return reply(200, { ok: true, confidence: faces[0].Confidence });
  } catch (e) {
    return reply(200, { ok: false, error: 'Erreur Rekognition : ' + (e.message || e.name) });
  }
};