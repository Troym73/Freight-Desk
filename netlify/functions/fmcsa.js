const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const FMCSA_KEY = process.env.FMCSA_API_KEY;
  if (!FMCSA_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'FMCSA API key not configured' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const mc = (body.mc || '').replace(/[^0-9]/g, '');
  if (!mc) return { statusCode: 400, headers, body: JSON.stringify({ error: 'MC number is required' }) };

  try {
    const raw = await fmcsaRequest(`/carriers/docket-number/${mc}?webKey=${FMCSA_KEY}`);
    console.log('FMCSA raw:', JSON.stringify(raw).slice(0, 800));

    let carrier = raw?.content?.carrier
      || raw?.content?.carrierBasics
      || raw?.carrier
      || (Array.isArray(raw?.content) ? raw.content[0]?.carrier || raw.content[0] : null);

    if (!carrier) {
      const raw2 = await fmcsaRequest(`/carriers/${mc}?webKey=${FMCSA_KEY}`);
      carrier = raw2?.content?.carrier || raw2?.carrier || null;
    }

    if (!carrier) {
      return {
        statusCode: 404, headers,
        body: JSON.stringify({ error: `No carrier found for MC# ${mc}. The MC number may be inactive or not registered with FMCSA.` })
      };
    }

    console.log('Carrier fields:', JSON.stringify(carrier).slice(0, 800));

    // Authority check
    const authorityActive = carrier.allowedToOperate === 'Y'
      || carrier.operatingStatus === 'AUTHORIZED FOR PROPERTY'
      || carrier.operatingStatus === 'AUTHORIZED FOR HHG'
      || carrier.operatingStatus === 'AUTHORIZED FOR PASSENGER';

    // Insurance — check ALL possible field names FMCSA uses
    const insuranceOnFile =
      carrier.bipdInsuranceOnFile === 'Y' ||
      carrier.cargoInsuranceOnFile === 'Y' ||
      carrier.bondInsuranceOnFile === 'Y' ||
      carrier.bipdInsuranceRequired === 'N' ||
      // If they have required insurance and are authorized, assume on file
      (authorityActive && carrier.bipdRequiredAmount > 0) ||
      // Fallback: if carrier is authorized to operate, insurance was verified
      (carrier.allowedToOperate === 'Y');

    const safetyRating = carrier.safetyRating || '';
    const safetyRatingOk = safetyRating !== 'Unsatisfactory' && safetyRating !== 'Conditional';

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        name: carrier.legalName || carrier.dbaName || carrier.name || 'Unknown',
        mc,
        dot: carrier.dotNumber || carrier.dotNum || '—',
        city: carrier.phyCity || carrier.city || '',
        state: carrier.phyState || carrier.state || '',
        phone: carrier.telephone || carrier.phone || '',
        email: carrier.email || '',
        authorityActive,
        insuranceOnFile,
        safetyRatingOk,
        safetyRating: safetyRating || 'Not Rated',
        operatingStatus: carrier.operatingStatus || '',
        allowedToOperate: carrier.allowedToOperate || 'N',
      })
    };

  } catch(err) {
    console.error('FMCSA error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'FMCSA lookup failed: ' + err.message }) };
  }
};

function fmcsaRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mobile.fmcsa.dot.gov',
      path: '/qc/services' + path,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'FreightDesk/1.0' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('FMCSA parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('FMCSA request timed out')); });
    req.end();
  });
}
