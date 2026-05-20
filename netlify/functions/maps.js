const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + data)); }
      });
    }).on('error', reject);
  });
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!MAPS_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No API key' }) };
  }
  try {
    const { type, origin, destination, waypoints } = JSON.parse(event.body);
    if (type === 'distance') {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&units=imperial&mode=driving&key=${MAPS_KEY}`;
      const data = await httpsGet(url);
      // Return full Google response so we can debug
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ debug: data })
      };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type' }) };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
