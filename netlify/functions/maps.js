const https = require('https');

function httpsPost(url, postData, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: headers
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
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
    const { type, input, origin, destination, waypoints } = JSON.parse(event.body);

    if (type === 'autocomplete') {
      const postData = JSON.stringify({ input, includedRegionCodes: ['us'] });
      const data = await httpsPost(
        'https://places.googleapis.com/v1/places:autocomplete',
        postData,
        { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS_KEY, 'Content-Length': Buffer.byteLength(postData) }
      );
      const suggestions = (data.suggestions || []).map(s => ({
        description: s.placePrediction?.text?.text || '',
        place_id: s.placePrediction?.placeId || ''
      })).filter(s => s.description);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ suggestions })
      };
    }

    if (type === 'distance') {
      const clean = s => s.replace(/, USA$/, '').trim();
      const intermediates = (waypoints || []).map(w => ({ address: clean(w) }));
      const body = {
        origin: { address: clean(origin) },
        destination: { address: clean(destination) },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: false,
        units: 'IMPERIAL'
      };
      if (intermediates.length > 0) body.intermediates = intermediates;
      const postData = JSON.stringify(body);
      const data = await httpsPost(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        postData,
        {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': MAPS_KEY,
          'X-Goog-FieldMask': 'routes.distanceMeters',
          'Content-Length': Buffer.byteLength(postData)
        }
      );
      let totalMiles = 0;
      if (data.routes && data.routes[0]) {
        totalMiles = Math.round(data.routes[0].distanceMeters / 1609.344);
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ miles: totalMiles })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type' }) };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
