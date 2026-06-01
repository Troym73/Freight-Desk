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

      console.log('Places search:', { query, location, radius });

      // Step 1: Geocode the city
      const geoData = await googleRequest(`/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${KEY}`);
      console.log('Geocode status:', geoData.status, 'results:', geoData.results?.length);

      if (!geoData.results?.length || geoData.status !== 'OK') {
        return { statusCode: 200, headers, body: JSON.stringify({ places: [], error: 'Could not geocode location: ' + location + ' — status: ' + geoData.status }) };
      }

      const loc = geoData.results[0].geometry.location;
      console.log('Geocoded to:', loc);

      // Step 2: Text search for businesses
      const searchUrl = `/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${loc.lat},${loc.lng}&radius=${radius}&key=${KEY}`;
      console.log('Search URL path:', searchUrl.replace(KEY, 'HIDDEN'));

      const searchData = await googleRequest(searchUrl);
      console.log('Search status:', searchData.status, 'results:', searchData.results?.length, 'error:', searchData.error_message);

      if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
        return { statusCode: 200, headers, body: JSON.stringify({ places: [], error: 'Places API error: ' + searchData.status + ' — ' + (searchData.error_message || '') }) };
      }

      const rawPlaces = (searchData.results || []).slice(0, 12);

      // Step 3: Get phone + website for each place
      const places = await Promise.all(rawPlaces.map(async p => {
        let phone = '', website = '';
        try {
          const det = await googleRequest(`/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_phone_number,website&key=${KEY}`);
          phone = det.result?.formatted_phone_number || '';
          website = det.result?.website || '';
        } catch(e) { console.log('Detail fetch failed for', p.name); }
        return {
          name: p.name,
          address: p.formatted_address || '',
          phone,
          website,
          rating: p.rating || null,
          placeId: p.place_id,
        };
      }));

      console.log('Returning', places.length, 'places');
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
