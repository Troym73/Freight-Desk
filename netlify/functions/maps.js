const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Google Maps API key not configured' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  try {
    // ── AUTOCOMPLETE ──
    if (body.type === 'autocomplete') {
      const input = encodeURIComponent(body.input || '');
      const data = await googleRequest(`/maps/api/place/autocomplete/json?input=${input}&types=(cities)&key=${KEY}`);
      const suggestions = (data.predictions || []).map(p => ({ description: p.description, placeId: p.place_id }));
      return { statusCode: 200, headers, body: JSON.stringify({ suggestions }) };
    }

    // ── DISTANCE / ROUTING ──
    if (body.type === 'distance') {
      const origin = encodeURIComponent(body.origin || '');
      const destination = encodeURIComponent(body.destination || '');
      const waypoints = body.waypoints?.length
        ? '&waypoints=' + body.waypoints.map(w => encodeURIComponent(w)).join('|')
        : '';
      const data = await googleRequest(`/maps/api/directions/json?origin=${origin}&destination=${destination}${waypoints}&mode=driving&key=${KEY}`);
      let miles = 0;
      if (data.routes?.[0]) {
        const legs = data.routes[0].legs || [];
        miles = Math.round(legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0) / 1609.34);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ miles }) };
    }

    // ── PLACES SEARCH (for Lead Generator) ──
    if (body.type === 'places') {
      const query = encodeURIComponent(body.query || '');
      const location = encodeURIComponent(body.location || '');
      const radius = body.radius || 40000;

      // First geocode the location to get lat/lng
      const geoData = await googleRequest(`/maps/api/geocode/json?address=${location}&key=${KEY}`);
      const loc = geoData.results?.[0]?.geometry?.location;
      if (!loc) return { statusCode: 200, headers, body: JSON.stringify({ places: [] }) };

      // Then search nearby
      const searchData = await googleRequest(
        `/maps/api/place/textsearch/json?query=${query}&location=${loc.lat},${loc.lng}&radius=${radius}&key=${KEY}`
      );

      const places = (searchData.results || []).slice(0, 12).map(p => ({
        name: p.name,
        address: p.formatted_address,
        phone: p.formatted_phone_number || '',
        website: p.website || '',
        rating: p.rating || null,
        placeId: p.place_id,
      }));

      // Get phone/website details for top results
      const detailed = await Promise.all(places.slice(0, 8).map(async p => {
        try {
          const det = await googleRequest(`/maps/api/place/details/json?place_id=${p.placeId}&fields=name,formatted_phone_number,website&key=${KEY}`);
          return {
            ...p,
            phone: det.result?.formatted_phone_number || p.phone || '',
            website: det.result?.website || p.website || '',
          };
        } catch(e) { return p; }
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ places: [...detailed, ...places.slice(8)] }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown request type' }) };

  } catch(err) {
    console.error('Maps error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Maps API error: ' + err.message }) };
  }
};

function googleRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'maps.googleapis.com',
      path,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}
