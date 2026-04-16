import { NextResponse } from 'next/server';
import { SerpApiProvider } from '@/lib/serpapi-provider';

export async function GET() {
  // Prevent execution during build time
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE === 'phase-production-build') {
    return NextResponse.json({
      success: false,
      error: 'Test endpoint disabled during build',
      providerReady: false,
      searchApiWorking: false,
      detailsApiWorking: false,
    }, { status: 503 });
  }

  console.log('🧪 Testing complete SerpAPI integration...');

  try {
    // Test provider instantiation
    const serpApiProvider = new SerpApiProvider();
    console.log('✅ SerpApiProvider created successfully');

    // Test actual API calls
    console.log('📡 Testing actual SerpAPI calls...');

    try {
      const searchResult = await serpApiProvider.searchPatents({
        q: 'machine learning',
        num: 10,
      });

      console.log('✅ Search API call successful!');
      console.log(`📊 Found ${searchResult.organic_results?.length || 0} results`);

      return NextResponse.json({
        success: true,
        message: '🎉 SerpAPI integration working perfectly!',
        providerReady: true,
        searchApiWorking: true,
        detailsApiWorking: false, // Not tested yet
        resultsFound: searchResult.organic_results?.length || 0,
        rateLimit: process.env.SERP_RATE || '5',
        hasApiKey: !!process.env.Serp_API_KEY,
        apiKeyLength: process.env.Serp_API_KEY?.length,
      });

    } catch (apiError) {
      console.error('❌ API call failed:', apiError);

      return NextResponse.json({
        success: false,
        message: 'Provider works, but API calls failed',
        providerReady: true,
        searchApiWorking: false,
        detailsApiWorking: false,
        error: apiError instanceof Error ? apiError.message : 'API call failed',
        rateLimit: process.env.SERP_RATE || '5',
        hasApiKey: !!process.env.Serp_API_KEY,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ SerpAPI test failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      providerReady: false,
      searchApiWorking: false,
      detailsApiWorking: false,
    }, { status: 500 });
  }
}