import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.roles?.includes('TENANT_ADMIN') && !user.roles?.includes('SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tenantId = user.tenantId;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Get users in tenant with paper counts
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roles: true,
      createdAt: true
    },
    skip: offset,
    take: limit
  });

  // Get paper counts and last activity for each user
  const userIds = users.map(u => u.id);
  const paperStats = await prisma.draftingSession.groupBy({
    by: ['userId'],
    where: {
      userId: { in: userIds },
      paperTypeId: { not: null }
    },
    _count: { id: true },
    _max: { updatedAt: true }
  });

  const statsMap = new Map(
    paperStats.map(s => [s.userId, { count: s._count.id, lastActivity: s._max.updatedAt }])
  );

  const usersWithMetrics = users.map(u => ({
    id: u.id,
    email: u.email,
    first_name: u.firstName,
    last_name: u.lastName,
    roles: u.roles,
    created_at: u.createdAt,
    papersCount: statsMap.get(u.id)?.count || 0,
    lastPaperActivity: statsMap.get(u.id)?.lastActivity || null
  }));

  // Sort by papers count descending
  usersWithMetrics.sort((a, b) => b.papersCount - a.papersCount);

  return NextResponse.json({ users: usersWithMetrics });
}
