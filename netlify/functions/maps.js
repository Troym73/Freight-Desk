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

    // Autocomplete suggestions
    if (type === 'autocomplete') {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=(cities)&components=country:us&key=${MAPS_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const suggestions = (data.predictions || []).map(p => ({
        description: p.description,
        place_id: p.place_id
      }));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ suggestions })
      };
    }

    // Distance Matrix - supports waypoints for multi-stop
    if (type === 'distance') {
      let waypointStr = '';
      if (waypoints && waypoints.length > 0) {
        waypointStr = `&waypoints=${waypoints.map(w => encodeURIComponent(w)).join('|')}`;
      }
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}${waypointStr}&units=imperial&mode=driving&key=${MAPS_KEY}`;
      const res = await fetch(url);
      const data = await res.json();

      // Sum up all leg distances for multi-stop routes
      let totalMiles = 0;
      let routeDesc = '';
      if (data.rows && data.rows[0] && data.rows[0].elements) {
        data.rows[0].elements.forEach(el => {
          if (el.status === 'OK') {
            totalMiles += el.distance.value / 1609.344;
          }
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
