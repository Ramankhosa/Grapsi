const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testCountryAPI() {
  try {
    console.log('Testing /api/country-profiles endpoint...\n');

    // Test without auth first
    console.log('Testing without authorization...');
    const responseNoAuth = await fetch('http://localhost:3005/api/country-profiles');
    console.log(`Status: ${responseNoAuth.status}`);
    const dataNoAuth = await responseNoAuth.json();
    console.log('Response:', JSON.stringify(dataNoAuth, null, 2));

  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testCountryAPI();
