import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify admin role
  if (!user.roles?.includes('TENANT_ADMIN') && !user.roles?.includes('SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tenantId = user.tenantId;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());

  // Get papers for tenant
  const papers = await prisma.draftingSession.findMany({
    where: {
      tenantId,
      paperTypeId: { not: null }
    },
    include: {
      paperType: { select: { code: true, name: true } },
      citationStyle: { select: { code: true, name: true } },
      publicationVenue: { select: { code: true, name: true } }
    }
  });

  // Calculate analytics
  const totalPapers = papers.length;
  const papersThisMonth = papers.filter(p => p.createdAt >= startOfMonth).length;
  const papersThisWeek = papers.filter(p => p.createdAt >= startOfWeek).length;

  // Get unique user count for average calculation
  const uniqueUsers = new Set(papers.map(p => p.userId)).size;
  const averagePapersPerUser = uniqueUsers > 0 ? totalPapers / uniqueUsers : 0;

  // Paper types distribution
  const paperTypeCounts: Record<string, number> = {};
  papers.forEach(p => {
    const type = p.paperType?.name || 'Unknown';
    paperTypeCounts[type] = (paperTypeCounts[type] || 0) + 1;
  });
  const paperTypes = Object.entries(paperTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Citation styles distribution
  const citationStyleCounts: Record<string, number> = {};
  papers.forEach(p => {
    const style = p.citationStyle?.name || 'Unknown';
    citationStyleCounts[style] = (citationStyleCounts[style] || 0) + 1;
  });
  const citationStyles = Object.entries(citationStyleCounts)
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count);

  // Top venues
  const venueCounts: Record<string, number> = {};
  papers.forEach(p => {
    if (p.publicationVenue?.name) {
      venueCounts[p.publicationVenue.name] = (venueCounts[p.publicationVenue.name] || 0) + 1;
    }
  });
  const topVenues = Object.entries(venueCounts)
    .map(([venue, count]) => ({ venue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    totalPapers,
    papersThisMonth,
    papersThisWeek,
    averagePapersPerUser: Math.round(averagePapersPerUser * 10) / 10,
    paperTypes,
    citationStyles,
    topVenues
  });
}
