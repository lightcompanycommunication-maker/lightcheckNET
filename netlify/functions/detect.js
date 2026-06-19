const https = require('https');
const querystring = require('querystring');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { image_base64, api_key, api_secret } = JSON.parse(event.body);

    if (!image_base64 || !api_key || !api_secret) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Paramètres manquants : image_base64, api_key, api_secret requis.' })
      };
    }

    const postData = querystring.stringify({
      api_key,
      api_secret,
      image_base64,
      return_attributes: 'none'
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api-us.faceplusplus.com',
        path: '/facepp/v3/detect',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
