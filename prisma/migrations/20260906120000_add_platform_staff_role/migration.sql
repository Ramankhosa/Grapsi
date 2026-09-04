-- Platform staff with no inherent access.
--
-- Until now the only roles legal inside the PLATFORM tenant were SUPER_ADMIN
-- and SUPER_ADMIN_VIEWER, so the only way to give somebody a scoped platform
-- capability (e.g. FUNDING_OPERATIONS_MANAGER) was to first make them a
-- Super Admin Viewer — cross-tenant read on every platform screen — and then
-- narrow them with a team role. PLATFORM_STAFF is the empty base that closes
-- that hole: it satisfies the "is a platform user" test that gates team-role
-- assignment, but carries no read or write of its own.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_STAFF';
