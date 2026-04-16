import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.roles?.includes('SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get all papers across platform
  const papers = await prisma.draftingSession.findMany({
    where: { paperTypeId: { not: null } },
    include: {
      paperType: { select: { code: true, name: true } },
      citationStyle: { select: { code: true, name: true } },
      citations: { select: { id: true } }
    }
  });

  const totalPapers = papers.length;

  // Monthly trend (last 12 months)
  const now = new Date();
  const papersTrend: Array<{ month: string; count: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const count = papers.filter(p => p.createdAt >= monthStart && p.createdAt <= monthEnd).length;
    papersTrend.push({ month: monthLabel, count });
  }

  // Paper types popularity
  const paperTypeCounts: Record<string, number> = {};
  papers.forEach(p => {
    const type = p.paperType?.name || 'Unknown';
    paperTypeCounts[type] = (paperTypeCounts[type] || 0) + 1;
  });
  const paperTypesPopularity = Object.entries(paperTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Citation styles usage
  const citationStyleCounts: Record<string, number> = {};
  papers.forEach(p => {
    const style = p.citationStyle?.name || 'Unknown';
    citationStyleCounts[style] = (citationStyleCounts[style] || 0) + 1;
  });
  const citationStylesUsage = Object.entries(citationStyleCounts)
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count);

  // Literature search API usage (from logs or counters)
  // This would typically come from a usage tracking table
  const literatureSearchUsage = {
    totalSearches: 0, // TODO: Implement usage tracking
    apiUsage: {
      'Google Scholar': 0,
      'Semantic Scholar': 0,
      'CrossRef': 0,
      'OpenAlex': 0
    }
  };

  // Average citations by paper type
  const citationsByType: Record<string, { total: number; count: number }> = {};
  papers.forEach(p => {
    const type = p.paperType?.name || 'Unknown';
    if (!citationsByType[type]) {
      citationsByType[type] = { total: 0, count: 0 };
    }
    citationsByType[type].total += p.citations.length;
    citationsByType[type].count += 1;
  });
  const averageCitationsByType = Object.entries(citationsByType)
    .map(([type, data]) => ({
      type,
      averageCitations: Math.round((data.total / data.count) * 10) / 10
    }))
    .sort((a, b) => b.averageCitations - a.averageCitations);

  return NextResponse.json({
    totalPapers,
    papersTrend,
    paperTypesPopularity,
    citationStylesUsage,
    literatureSearchUsage,
    averageCitationsByType
  });
}
