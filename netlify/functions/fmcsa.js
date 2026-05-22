const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const FMCSA_KEY = process.env.FMCSA_API_KEY;
  if (!FMCSA_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'FMCSA API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const mc = (body.mc || '').replace(/[^0-9]/g, '');
  if (!mc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'MC number is required' }) };
  }

  try {
    // FMCSA API lookup by MC number
    const fmcsaData = await fmcsaRequest(`/carriers/docket-number/${mc}?webKey=${FMCSA_KEY}`);

    if (!fmcsaData || !fmcsaData.content || !fmcsaData.content.carrier) {
      return {
        statusCode: 404, headers,
        body: JSON.stringify({ error: `No carrier found for MC# ${mc}. Verify the number and try again.` })
      };
    }

    const carrier = fmcsaData.content.carrier;

    // Check authority status
    const authorityActive = carrier.allowedToOperate === 'Y';

    // Check insurance
    const insuranceOnFile = carrier.totalDrivers > 0 || carrier.bipdInsuranceRequired === 'N' || carrier.bipdInsuranceOnFile === 'Y';

    // Check safety rating
    const safetyRating = carrier.safetyRating || '';
    const safetyRatingOk = safetyRating !== 'Unsatisfactory' && safetyRating !== 'Conditional';

    const result = {
      name: carrier.legalName || carrier.dbaName || 'Unknown',
      mc: mc,
      dot: carrier.dotNumber || '—',
      city: carrier.phyCity || '',
      state: carrier.phyState || '',
      phone: carrier.telephone || '',
      email: carrier.email || '',
      authorityActive,
      insuranceOnFile,
      safetyRatingOk,
      safetyRating: safetyRating || 'Not Rated',
      operatingStatus: carrier.operatingStatus || '',
      allowedToOperate: carrier.allowedToOperate || 'N',
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch(err) {
    console.error('FMCSA error:', err.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'FMCSA lookup failed: ' + err.message })
    };
  }
};

function fmcsaRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mobile.fmcsa.dot.gov',
      path: '/qc/services' + path,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from FMCSA: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('FMCSA request timed out')); });
    req.end();
  });
}
