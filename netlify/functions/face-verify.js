// netlify/functions/face-verify.js
// Vérification faciale via AWS Rekognition (CompareFaces).
// Variables d'environnement Netlify requises :
//   REKO_ACCESS_KEY_ID, REKO_SECRET_ACCESS_KEY, REKO_REGION (def. us-east-1)
// Permission IAM : rekognition:CompareFaces
const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');

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
  if (event.httpMethod !== 'POST') return reply(405, { confidence: 0, error: 'Méthode non autorisée.' });
  try {
    const { source_base64, target_base64 } = JSON.parse(event.body || '{}');
    if (!source_base64 || !target_base64) return reply(200, { confidence: 0, error: 'Image source ou cible manquante.' });
    const out = await client.send(new CompareFacesCommand({
      SourceImage: { Bytes: b64(source_base64) },
      TargetImage: { Bytes: b64(target_base64) },
      SimilarityThreshold: 1
    }));
    const m = out.FaceMatches || [];
    return reply(200, { confidence: m.length ? m[0].Similarity : 0, matched: m.length > 0 });
  } catch (e) {
    if (/InvalidParameter/i.test(e.name || ''))
      return reply(200, { confidence: 0, error: 'Aucun visage détecté — repositionnez-vous face à la caméra.' });
    return reply(200, { confidence: 0, error: 'Erreur Rekognition : ' + (e.message || e.name) });
  }
};