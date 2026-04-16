// Simple test to check if API is responding
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3005,
  path: '/api/country-profiles',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    // No auth header - should get 401
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Response:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();








