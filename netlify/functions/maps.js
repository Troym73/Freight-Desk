exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!MAPS_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Maps API key not configured.' }) };
  }
  try {
    const { type, input, origin, destination, waypoints } = JSON.parse(event.body);

    // ── AUTOCOMPLETE (Places API New) ──
    if (type === 'autocomplete') {
      const res = await fetch(
        `https://places.googleapis.com/v1/places:autocomplete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': MAPS_KEY
          },
          body: JSON.stringify({
            input,
            includedRegionCodes: ['us'],
            includedPrimaryTypes: ['locality', 'administrative_area_level_3']
          })
        }
      );
      const data = await res.json();
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

    // ── DISTANCE via Directions API (supports waypoints correctly) ──
    if (type === 'distance') {
      let waypointStr = '';
      if (waypoints && waypoints.length > 0) {
        waypointStr = `&waypoints=${waypoints.map(w => encodeURIComponent(w)).join('|')}`;
      }
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointStr}&units=imperial&mode=driving&key=${MAPS_KEY}`
      );
      const data = await res.json();
      let totalMiles = 0;
      if (data.routes && data.routes[0] && data.routes[0].legs) {
        data.routes[0].legs.forEach(leg => {
          totalMiles += leg.distance.value / 1609.344;
        });
      }
      totalMiles = Math.round(totalMiles);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ miles: totalMiles })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown request type' }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error: ' + err.message })
    };
  }
};
