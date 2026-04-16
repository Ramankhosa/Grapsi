-- Create system user for seeding scripts
INSERT INTO "User" (id, email, name, roles, status, "emailVerified", "noveltySearchesCompleted", "createdAt", "updatedAt") 
VALUES (
  'system-seed-user', 
  'system@spotipr.local', 
  'System Seed User', 
  ARRAY['SUPER_ADMIN']::"UserRole"[], 
  'ACTIVE', 
  true,
  0,
  NOW(), 
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Also create a regular super admin if needed
INSERT INTO "User" (id, email, name, roles, status, "emailVerified", "noveltySearchesCompleted", "createdAt", "updatedAt") 
VALUES (
  'cmik10pcp000425pvf6s92gqz', 
  'superadmin@spotipr.com', 
  'Super Admin', 
  ARRAY['SUPER_ADMIN']::"UserRole"[], 
  'ACTIVE', 
  true,
  0,
  NOW(), 
  NOW()
)
ON CONFLICT (id) DO NOTHING;

