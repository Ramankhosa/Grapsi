import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config({ path: '.env', override: false });
dotenv.config({ path: '.env.local', override: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Could not parse JSON response (${response.status}): ${text}`);
  }
}

function getSeedModule(rawModule: any) {
  return rawModule.seedFundingFinderVerificationData ? rawModule : rawModule.default;
}

async function main() {
  const [
    { generateJWT },
    { NextRequest },
    seedModuleRaw,
    manualSearchRoute,
    facetsRoute,
    conversationsRoute,
    messageRoute,
    contextRoute,
  ] = await Promise.all([
    import('../src/lib/auth'),
    import('next/server'),
    import('./seed-funding-finder-verification'),
    import('../src/app/api/recommendations/manual-search/route'),
    import('../src/app/api/recommendations/directory/facets/route'),
    import('../src/app/api/recommendations/conversations/route'),
    import('../src/app/api/recommendations/conversations/[id]/messages/route'),
    import('../src/app/api/researcher/context/route'),
  ]);

  const seedModule = getSeedModule(seedModuleRaw);
  const seeded = await seedModule.seedFundingFinderVerificationData();
  assert(seeded.publishedActive >= 15, `Expected at least 15 active seeded calls, got ${seeded.publishedActive}`);
  assert(seeded.approvedTemplates >= 15, `Expected at least 15 approved templates, got ${seeded.approvedTemplates}`);
  assert(seeded.approvedGuidelines >= 15, `Expected at least 15 approved guidelines, got ${seeded.approvedGuidelines}`);
  assert(Array.isArray(seeded.seededProfiles) && seeded.seededProfiles.length === 5, 'Expected five seeded researcher profiles');

  const makeToken = (user: { userId: string; email: string }) => generateJWT({
    sub: user.userId,
    email: user.email,
    tenant_id: seeded.tenantId,
    roles: ['ANALYST'],
    ati_id: null,
    tenant_ati_id: seedModule.FINDER_VERIFICATION_TENANT_ATI,
    scope: 'tenant',
  });

  const token = makeToken({ userId: seeded.userId, email: seeded.userEmail });
  const authHeaders = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const contextRequest = new NextRequest('http://localhost/api/researcher/context', {
    method: 'GET',
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  const contextResponse = await contextRoute.GET(contextRequest);
  const contextBody = await readJson(contextResponse);
  assert(contextResponse.status === 200, `Researcher context failed: ${JSON.stringify(contextBody)}`);
  assert(Array.isArray(contextBody.researchAreas) && contextBody.researchAreas.length > 0, 'Researcher context did not return saved research areas');

  const manualSearchRequest = new NextRequest('http://localhost/api/recommendations/manual-search', {
    method: 'POST',
    headers: new Headers(authHeaders),
    body: JSON.stringify({
      query: 'clinical imaging fellowship',
      filters: {
        eligibleCountries: ['India'],
        fundingKinds: ['Fellowship'],
        limit: 5,
        sort: 'best_match',
      },
    }),
  });
  const manualSearchResponse = await manualSearchRoute.POST(manualSearchRequest);
  const manualSearchBody = await readJson(manualSearchResponse);
  assert(manualSearchResponse.status === 200, `Manual search failed: ${JSON.stringify(manualSearchBody)}`);
  assert(manualSearchBody.totalResults > 0, 'Manual search returned zero results');
  const manualTitles = (manualSearchBody.results || []).map((item: any) => item.schemeTitle);
  assert(
    manualTitles.includes(seedModule.FINDER_EXPECTED_PRIMARY_TITLE),
    `Manual search did not return ${seedModule.FINDER_EXPECTED_PRIMARY_TITLE}. Results: ${manualTitles.join(', ')}`
  );
  assert(
    !manualTitles.includes(seedModule.FINDER_EXPECTED_HIDDEN_TITLE),
    'Manual search returned the hidden archived verification call'
  );

  const profileScenarios = [
    { email: seedModule.FINDER_VERIFICATION_USER_EMAIL, query: 'medical imaging diagnostics', expectedTitle: seedModule.FINDER_EXPECTED_PRIMARY_TITLE },
    { email: 'finder.climate@grapsi.local', query: 'climate resilient agriculture', expectedTitle: 'Climate Resilient Agriculture Research Grant' },
    { email: 'finder.quantum@grapsi.local', query: 'quantum materials spectroscopy', expectedTitle: 'Quantum Materials Equipment Grant' },
    { email: 'finder.publichealth@grapsi.local', query: 'digital public health implementation', expectedTitle: 'Public Health Innovation Seed Grant' },
    { email: 'finder.policy@grapsi.local', query: 'responsible ai policy governance', expectedTitle: 'Responsible AI Policy Small Grant' },
  ];

  const profileChecks = [];
  for (const scenario of profileScenarios) {
    const profile = seeded.seededProfiles.find((item: any) => item.email === scenario.email);
    assert(profile, `Missing seeded profile for ${scenario.email}`);
    const profileToken = makeToken(profile);
    const profileSearchRequest = new NextRequest('http://localhost/api/recommendations/manual-search', {
      method: 'POST',
      headers: new Headers({
        authorization: `Bearer ${profileToken}`,
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        query: scenario.query,
        useEligibilityProfile: true,
        usePublicationContext: true,
        filters: {
          limit: 5,
          sort: 'best_match',
        },
      }),
    });
    const profileSearchResponse = await manualSearchRoute.POST(profileSearchRequest);
    const profileSearchBody = await readJson(profileSearchResponse);
    assert(profileSearchResponse.status === 200, `Profile search failed for ${scenario.email}: ${JSON.stringify(profileSearchBody)}`);
    const profileTitles = (profileSearchBody.results || []).map((item: any) => item.schemeTitle);
    assert(
      profileTitles.slice(0, 3).includes(scenario.expectedTitle),
      `Profile search for ${scenario.email} did not rank ${scenario.expectedTitle} in top 3. Results: ${profileTitles.join(', ')}`
    );
    const expectedResult = (profileSearchBody.results || []).find((item: any) => item.schemeTitle === scenario.expectedTitle);
    assert(expectedResult?.profileMatch, `Expected profileMatch diagnostics for ${scenario.expectedTitle}`);
    profileChecks.push({
      email: scenario.email,
      topTitles: profileTitles.slice(0, 3),
      profileReasons: expectedResult.profileMatch?.reasons || [],
    });
  }

  const facetsRequest = new NextRequest('http://localhost/api/recommendations/directory/facets', {
    method: 'POST',
    headers: new Headers(authHeaders),
    body: JSON.stringify({
      query: 'artificial intelligence',
      filters: { eligibleCountries: ['India'] },
    }),
  });
  const facetsResponse = await facetsRoute.POST(facetsRequest);
  const facetsBody = await readJson(facetsResponse);
  assert(facetsResponse.status === 200, `Facet search failed: ${JSON.stringify(facetsBody)}`);
  assert(facetsBody.totalPublished > 0, 'Facet search returned zero published calls');
  assert(
    Array.isArray(facetsBody.facets?.fundingKind) && facetsBody.facets.fundingKind.length > 0,
    'Facet search did not return funding-kind facets'
  );

  const createConversationRequest = new NextRequest('http://localhost/api/recommendations/conversations', {
    method: 'POST',
    headers: new Headers(authHeaders),
    body: JSON.stringify({ title: 'Funding Finder Verification' }),
  });
  const createConversationResponse = await conversationsRoute.POST(createConversationRequest);
  const createConversationBody = await readJson(createConversationResponse);
  assert(
    createConversationResponse.status === 201 && createConversationBody.conversation?.id,
    `Conversation creation failed: ${JSON.stringify(createConversationBody)}`
  );

  const conversationId = createConversationBody.conversation.id;
  const optOutMessageRequest = new NextRequest(
    `http://localhost/api/recommendations/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: new Headers(authHeaders),
      body: JSON.stringify({
        message: 'Find grants eligible for me.',
        clientTurnId: 'verification-profile-optout',
      }),
    }
  );
  const optOutMessageResponse = await messageRoute.POST(optOutMessageRequest, { params: { id: conversationId } });
  const optOutMessageBody = await readJson(optOutMessageResponse);
  assert(optOutMessageResponse.status === 200, `Profile opt-out chatbot check failed: ${JSON.stringify(optOutMessageBody)}`);
  const optOutAssistant = optOutMessageBody.conversation?.messages?.filter((message: any) => message.role === 'assistant')?.slice(-1)?.[0];
  assert(optOutAssistant?.messageType === 'assistant_notice', 'Expected chatbot to ask for profile preference opt-in');
  assert(String(optOutAssistant?.content || '').includes('currently off'), 'Expected chatbot opt-in notice to mention preferences are off');

  const firstMessageRequest = new NextRequest(
    `http://localhost/api/recommendations/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: new Headers(authHeaders),
      body: JSON.stringify({
        message: 'Find medical imaging funding opportunities in India for an early career researcher.',
        useEligibilityProfile: true,
        usePublicationContext: true,
        clientTurnId: 'verification-turn-1',
      }),
    }
  );
  const firstMessageResponse = await messageRoute.POST(firstMessageRequest, { params: { id: conversationId } });
  const firstMessageBody = await readJson(firstMessageResponse);
  assert(firstMessageResponse.status === 200, `Finder chatbot first message failed: ${JSON.stringify(firstMessageBody)}`);
  const firstRun = firstMessageBody.conversation?.runs?.slice(-1)?.[0];
  const firstRunTitles = (firstRun?.results || []).map((item: any) => item.schemeTitle);
  assert(
    Array.isArray(firstRun?.results) && firstRun.results.length > 0,
    `Finder chatbot returned no grounded funding results: ${JSON.stringify(firstMessageBody)}`
  );
  assert(
    firstRunTitles.includes(seedModule.FINDER_EXPECTED_PRIMARY_TITLE),
    `Finder chatbot did not surface ${seedModule.FINDER_EXPECTED_PRIMARY_TITLE}. Results: ${firstRunTitles.join(', ')}`
  );
  assert(firstRun?.profileDiagnostics?.enabled === true, 'Finder chatbot did not include opted-in profile diagnostics');

  const secondMessageRequest = new NextRequest(
    `http://localhost/api/recommendations/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: new Headers(authHeaders),
      body: JSON.stringify({
        message: 'Only show fellowships.',
        useEligibilityProfile: true,
        usePublicationContext: true,
        clientTurnId: 'verification-turn-2',
      }),
    }
  );
  const secondMessageResponse = await messageRoute.POST(secondMessageRequest, { params: { id: conversationId } });
  const secondMessageBody = await readJson(secondMessageResponse);
  assert(secondMessageResponse.status === 200, `Finder chatbot refinement failed: ${JSON.stringify(secondMessageBody)}`);
  const secondRun = secondMessageBody.conversation?.runs?.slice(-1)?.[0];
  assert(Array.isArray(secondRun?.results) && secondRun.results.length > 0, 'Finder chatbot refinement returned no results');
  assert(
    (secondRun.results || []).every((item: any) => (item.fundingKinds || []).includes('Fellowship')),
    'Finder chatbot refinement did not narrow to fellowship results'
  );

  const latestAssistantMessage = secondMessageBody.conversation?.messages
    ?.filter((message: any) => message.role === 'assistant')
    ?.slice(-1)?.[0];

  console.log(
    JSON.stringify(
      {
        seededPublishedActiveCalls: seeded.publishedActive,
        approvedTemplates: seeded.approvedTemplates,
        approvedGuidelines: seeded.approvedGuidelines,
        seededProfiles: seeded.seededProfiles.length,
        researcherContextAreas: contextBody.researchAreas?.length || 0,
        manualSearch: {
          degradedMode: manualSearchBody.degradedMode ?? null,
          totalResults: manualSearchBody.totalResults,
          topTitles: manualTitles.slice(0, 3),
        },
        facets: {
          totalPublished: facetsBody.totalPublished,
          topFundingKinds: (facetsBody.facets?.fundingKind || []).slice(0, 5),
        },
        profileChecks,
        chatbot: {
          conversationId,
          optOutNotice: optOutAssistant?.content?.slice(0, 180) || null,
          firstRunDegradedMode: firstRun?.degradedMode ?? null,
          firstRunTopTitles: firstRunTitles.slice(0, 3),
          firstRunProfileReasons: firstRun?.results?.[0]?.profileMatch?.reasons || [],
          secondRunDegradedMode: secondRun?.degradedMode ?? null,
          secondRunTopTitles: (secondRun?.results || []).map((item: any) => item.schemeTitle).slice(0, 3),
          assistantPreview: latestAssistantMessage?.content?.slice(0, 300) || null,
        },
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
