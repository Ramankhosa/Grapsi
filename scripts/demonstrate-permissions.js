// Simple permission demonstration
function hasPermission(user, permission, tenantType) {
  if (!user?.roles) return false;

  switch (permission) {
    case 'manage_users':
      if (tenantType === 'INDIVIDUAL') {
        // In individual tenants, analysts can manage users (since they are the only user)
        return user.roles.some(role => ['OWNER', 'ADMIN', 'ANALYST'].includes(role));
      } else {
        // In enterprise tenants, only admins can manage users
        return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
      }

    case 'create_projects':
    case 'access_novelty_search':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));

    default:
      return false;
  }
}

// Mock users to demonstrate permission differences
const enterpriseAnalyst = {
  roles: ['ANALYST']
};

const enterpriseAdmin = {
  roles: ['ADMIN']
};

const individualUser = {
  roles: ['ADMIN', 'ANALYST']
};

console.log('🔐 PERMISSION COMPARISON: Enterprise vs Individual Tenants');
console.log('=' .repeat(70));
console.log('');

console.log('👤 Enterprise Analyst (ANALYST role only):');
console.log('   Can manage users: ', hasPermission(enterpriseAnalyst, 'manage_users', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('   Can create projects: ', hasPermission(enterpriseAnalyst, 'create_projects', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('   Can access novelty search: ', hasPermission(enterpriseAnalyst, 'access_novelty_search', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('');

console.log('👤 Enterprise Admin (ADMIN role only):');
console.log('   Can manage users: ', hasPermission(enterpriseAdmin, 'manage_users', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('   Can create projects: ', hasPermission(enterpriseAdmin, 'create_projects', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('   Can access novelty search: ', hasPermission(enterpriseAdmin, 'access_novelty_search', 'ENTERPRISE') ? '✅ YES' : '❌ NO');
console.log('');

console.log('👤 Individual User (ADMIN + ANALYST roles):');
console.log('   Can manage users: ', hasPermission(individualUser, 'manage_users', 'INDIVIDUAL') ? '✅ YES' : '❌ NO');
console.log('   Can create projects: ', hasPermission(individualUser, 'create_projects', 'INDIVIDUAL') ? '✅ YES' : '❌ NO');
console.log('   Can access novelty search: ', hasPermission(individualUser, 'access_novelty_search', 'INDIVIDUAL') ? '✅ YES' : '❌ NO');
console.log('');

console.log('🎯 KEY INSIGHT:');
console.log('   Enterprise tenants have STRICT role separation');
console.log('   Individual tenants allow FLEXIBLE multi-role permissions');
console.log('   Security is maintained through tenant-aware permission checks');
console.log('');
console.log('📋 TEST ACCOUNTS:');
console.log('   analyst@spotipr.com - Enterprise Analyst (cannot manage users)');
console.log('   solouser@spotipr.com - Individual User (can manage users + do analysis)');
