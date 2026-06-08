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

    // ── ROUTE STATES (for OD & Permits) — fast version ──
    if (body.type === 'route_states') {
      const origin = encodeURIComponent(body.origin || '');
      const destination = encodeURIComponent(body.destination || '');
      const data = await googleRequest(`/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${KEY}`);

      let miles = 0;
      const stateSet = new Set();

      // State abbreviation to full name map
      const stateNames = {
        'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
        'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
        'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas',
        'KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts',
        'MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana',
        'NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico',
        'NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma',
        'OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
        'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
        'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'
      };

      if (data.routes?.[0]) {
        const legs = data.routes[0].legs || [];
        miles = Math.round(legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0) / 1609.34);

        // Extract states from HTML instructions and addresses — no extra API calls needed
        const allText = legs.map(leg =>
          (leg.start_address || '') + ' ' +
          (leg.end_address || '') + ' ' +
          (leg.steps || []).map(s => s.html_instructions || '').join(' ')
        ).join(' ');

        // Also parse state abbreviations from addresses directly
        const addresses = legs.map(l => [l.start_address, l.end_address]).flat().join(' ');
        const abbrMatches = addresses.match(/,\s*([A-Z]{2})\s*(?:\d{5})?(?:,|$)/g) || [];
        abbrMatches.forEach(m => {
          const abbr = m.replace(/[^A-Z]/g, '').slice(-2);
          if (stateNames[abbr]) stateSet.add(stateNames[abbr]);
        });

        // For long routes, sample waypoints along the route to get intermediate states
        if (stateSet.size <= 2 && miles > 500) {
          // Get a few sample points from the route steps
          const allSteps = legs.flatMap(l => l.steps || []);
          const sampleInterval = Math.floor(allSteps.length / 4);
          const samplePoints = [];
          for (let i = sampleInterval; i < allSteps.length; i += sampleInterval) {
            if (allSteps[i]?.end_location) samplePoints.push(allSteps[i].end_location);
          }
          // Geocode sample points in parallel
          const geocodeResults = await Promise.all(
            samplePoints.slice(0,4).map(pt =>
              googleRequest(`/maps/api/geocode/json?latlng=${pt.lat},${pt.lng}&result_type=administrative_area_level_1&key=${KEY}`)
                .catch(() => null)
            )
          );
          geocodeResults.forEach(r => {
            if (!r) return;
            const comp = r.results?.[0]?.address_components?.find(c => c.types.includes('administrative_area_level_1'));
            if (comp?.long_name) stateSet.add(comp.long_name);
          });
        }
      }

      // Fallback: parse states from the input strings if still empty
      if (stateSet.size === 0) {
        const combined = (body.origin || '') + ' ' + (body.destination || '');
        Object.entries(stateNames).forEach(([abbr, name]) => {
          if (combined.includes(' ' + abbr) || combined.toLowerCase().includes(name.toLowerCase())) {
            stateSet.add(name);
          }
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ states: [...stateSet], miles }) };
    }

    // ── PLACES SEARCH (Lead Generator) ──
    if (body.type === 'places') {
      const query = body.query || '';
      const location = body.location || '';
      const radius = Math.min(body.radius || 40000, 50000);

      const geoData = await googleRequest(`/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${KEY}`);
      if (!geoData.results?.length || geoData.status !== 'OK') {
        return { statusCode: 200, headers, body: JSON.stringify({ places: [], error: 'Could not geocode location: ' + location + ' — status: ' + geoData.status }) };
      }
      const loc = geoData.results[0].geometry.location;
      const searchData = await googleRequest(`/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${loc.lat},${loc.lng}&radius=${radius}&key=${KEY}`);

      if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
        return { statusCode: 200, headers, body: JSON.stringify({ places: [], error: 'Places API error: ' + searchData.status }) };
      }

      const rawPlaces = (searchData.results || []).slice(0, 10);
      const detailPromises = rawPlaces.map(p =>
        googleRequest(`/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_phone_number,website&key=${KEY}`)
          .then(det => ({ name: p.name, address: p.formatted_address || '', phone: det.result?.formatted_phone_number || '', website: det.result?.website || '', rating: p.rating || null, placeId: p.place_id }))
          .catch(() => ({ name: p.name, address: p.formatted_address || '', phone: '', website: '', rating: p.rating || null, placeId: p.place_id }))
      );
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
    const options = { hostname: 'maps.googleapis.com', path, method: 'GET', headers: { 'Accept': 'application/json' } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}
