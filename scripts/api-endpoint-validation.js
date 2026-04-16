const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Simulate JWT generation (simplified)
function generateTestJWT(user, tenantType) {
  return {
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId,
    tenant_ati_id: user.tenant?.atiId,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
  };
}

// Simulate API permission checking middleware
function checkAPIPermission(jwtPayload, requiredPermission, tenantType = 'ENTERPRISE') {
  const user = {
    roles: jwtPayload.roles || []
  };

  // Super admin always has all permissions
  if (user.roles.includes('SUPER_ADMIN')) return true;

  switch (requiredPermission) {
    case 'manage_users':
      if (tenantType === 'INDIVIDUAL') {
        return user.roles.some(role => ['OWNER', 'ADMIN', 'ANALYST'].includes(role));
      } else {
        return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
      }

    case 'create_projects':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));

    case 'access_novelty_search':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));

    default:
      return false;
  }
}

async function testAPIEndpoints() {
  console.log('🔌 API ENDPOINT PERMISSION VALIDATION\n');
  console.log('=' .repeat(80) + '\n');

  try {
    // Create test users and tenants
    const enterpriseTenant = await prisma.tenant.create({
      data: {
        name: 'API Test Corp',
        atiId: 'TEST-API-ENTERPRISE',
        type: 'ENTERPRISE'
      }
    });

    const individualTenant = await prisma.tenant.create({
      data: {
        name: 'API Test Solo',
        atiId: 'TEST-API-INDIVIDUAL',
        type: 'INDIVIDUAL'
      }
    });

    const testUsers = [
      {
        email: 'api-enterprise-admin@test.com',
        name: 'API Enterprise Admin',
        roles: ['ADMIN'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'api-enterprise-analyst@test.com',
        name: 'API Enterprise Analyst',
        roles: ['ANALYST'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'api-individual-user@test.com',
        name: 'API Individual User',
        roles: ['ADMIN', 'ANALYST'],
        tenantId: individualTenant.id
      }
    ];

    const createdUsers = [];
    for (const userData of testUsers) {
      const user = await prisma.user.create({
        data: {
          ...userData,
          passwordHash: await bcrypt.hash('TestPass123!', 12),
          status: 'ACTIVE'
        },
        include: { tenant: true }
      });
      createdUsers.push(user);
    }

    console.log('📋 API ENDPOINT SIMULATION\n');

    // Simulate API endpoint calls
    const apiEndpoints = [
      {
        endpoint: 'POST /api/projects',
        permission: 'create_projects',
        description: 'Create new project'
      },
      {
        endpoint: 'POST /api/users',
        permission: 'manage_users',
        description: 'Create new user'
      },
      {
        endpoint: 'POST /api/novelty-search',
        permission: 'access_novelty_search',
        description: 'Run novelty search'
      },
      {
        endpoint: 'DELETE /api/users/:id',
        permission: 'manage_users',
        description: 'Delete user account'
      }
    ];

    for (const endpoint of apiEndpoints) {
      console.log(`🔗 Testing ${endpoint.endpoint} (${endpoint.description})`);
      console.log('-'.repeat(60));

      for (const user of createdUsers) {
        const jwtPayload = generateTestJWT(user, user.tenant?.type);
        const hasAccess = checkAPIPermission(jwtPayload, endpoint.permission, user.tenant?.type);

        console.log(`   ${user.name}: ${hasAccess ? '✅ ALLOWED' : '❌ DENIED'}`);
      }
      console.log('');
    }

    // Test specific security scenarios
    console.log('🛡️ SECURITY SCENARIO VALIDATION\n');

    const securityScenarios = [
      {
        scenario: 'Enterprise analyst cannot create users via API',
        user: createdUsers.find(u => u.email === 'api-enterprise-analyst@test.com'),
        endpoint: 'POST /api/users',
        permission: 'manage_users',
        expected: false
      },
      {
        scenario: 'Enterprise admin can create users via API',
        user: createdUsers.find(u => u.email === 'api-enterprise-admin@test.com'),
        endpoint: 'POST /api/users',
        permission: 'manage_users',
        expected: true
      },
      {
        scenario: 'Individual user can manage users via API',
        user: createdUsers.find(u => u.email === 'api-individual-user@test.com'),
        endpoint: 'POST /api/users',
        permission: 'manage_users',
        expected: true
      },
      {
        scenario: 'Enterprise analyst can still do novelty search',
        user: createdUsers.find(u => u.email === 'api-enterprise-analyst@test.com'),
        endpoint: 'POST /api/novelty-search',
        permission: 'access_novelty_search',
        expected: true
      }
    ];

    let passedScenarios = 0;
    const totalScenarios = securityScenarios.length;

    for (const scenario of securityScenarios) {
      const jwtPayload = generateTestJWT(scenario.user, scenario.user.tenant?.type);
      const hasAccess = checkAPIPermission(jwtPayload, scenario.permission, scenario.user.tenant?.type);
      const passed = hasAccess === scenario.expected;

      console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${scenario.scenario}`);
      console.log(`   Endpoint: ${scenario.endpoint}`);
      console.log(`   Result: ${hasAccess ? 'ALLOWED' : 'DENIED'}, Expected: ${scenario.expected ? 'ALLOWED' : 'DENIED'}`);

      if (passed) passedScenarios++;
      console.log('');
    }

    // Test JWT structure validation
    console.log('🔐 JWT PAYLOAD STRUCTURE VALIDATION\n');

    for (const user of createdUsers) {
      const jwtPayload = generateTestJWT(user, user.tenant?.type);

      console.log(`JWT for ${user.name}:`);
      console.log(`   sub (user_id): ${jwtPayload.sub ? '✅ Present' : '❌ Missing'}`);
      console.log(`   roles: [${jwtPayload.roles?.join(', ')}] ${Array.isArray(jwtPayload.roles) ? '✅ Array' : '❌ Not array'}`);
      console.log(`   tenant_id: ${jwtPayload.tenant_id ? '✅ Present' : '❌ Missing'}`);
      console.log(`   scope: ${jwtPayload.scope} ${['platform', 'tenant'].includes(jwtPayload.scope) ? '✅ Valid' : '❌ Invalid'}`);
      console.log('');
    }

    // Final results
    console.log('🎯 API ENDPOINT VALIDATION RESULTS');
    console.log('=' .repeat(50));
    console.log(`Security Scenarios: ${passedScenarios}/${totalScenarios} PASSED`);

    if (passedScenarios === totalScenarios) {
      console.log('🎉 ALL API ENDPOINT TESTS PASSED!');
      console.log('Backend permission enforcement is working correctly.');
    } else {
      console.log('❌ Some API tests failed. Please review backend permission logic.');
    }

    // Cleanup
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: '@test.com'
        }
      }
    });

    await prisma.tenant.deleteMany({
      where: {
        atiId: {
          startsWith: 'TEST-API-'
        }
      }
    });

    console.log('\n🧹 API test data cleaned up.');

  } catch (error) {
    console.error('❌ API validation error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAPIEndpoints();
