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

    // ── PLACES SEARCH (Lead Generator) ──
    if (body.type === 'places') {
      const query = body.query || '';
      const location = body.location || '';
      const radius = Math.min(body.radius || 40000, 50000);

      // Step 1: Geocode + Text Search in PARALLEL
      const [geoData, ] = await Promise.all([
        googleRequest(`/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${KEY}`)
      ]);

      if (!geoData.results?.length || geoData.status !== 'OK') {
        return { statusCode: 200, headers, body: JSON.stringify({
          places: [],
          error: 'Could not geocode location: ' + location + ' — status: ' + geoData.status
        })};
      }

      const loc = geoData.results[0].geometry.location;

      // Step 2: Text search (includes name, address, place_id in one call)
      const searchData = await googleRequest(
        `/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${loc.lat},${loc.lng}&radius=${radius}&fields=name,formatted_address,place_id,formatted_phone_number,website,rating,international_phone_number&key=${KEY}`
      );

      if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
        return { statusCode: 200, headers, body: JSON.stringify({
          places: [],
          error: 'Places API error: ' + searchData.status + ' — ' + (searchData.error_message || '')
        })};
      }

      const rawPlaces = (searchData.results || []).slice(0, 10);

      // Step 3: Fetch details for ALL places in PARALLEL (not sequential)
      // Only need phone + website which textsearch doesn't return
      const detailPromises = rawPlaces.map(p =>
        googleRequest(`/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_phone_number,website&key=${KEY}`)
          .then(det => ({
            name: p.name,
            address: p.formatted_address || '',
            phone: det.result?.formatted_phone_number || '',
            website: det.result?.website || '',
            rating: p.rating || null,
            placeId: p.place_id,
          }))
          .catch(() => ({
            name: p.name,
            address: p.formatted_address || '',
            phone: '',
            website: '',
            rating: p.rating || null,
            placeId: p.place_id,
          }))
      );

      // Run ALL detail fetches simultaneously
      const places = await Promise.all(detailPromises);

      return { statusCode: 200, headers, body: JSON.stringify({ places }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown request type: ' + body.type }) };

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
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}
