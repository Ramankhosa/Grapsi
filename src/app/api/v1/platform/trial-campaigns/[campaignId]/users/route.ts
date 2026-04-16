/**
 * Trial Campaign Users API - Get signed up users with their activity stats
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Missing token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload || !payload.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ code: 'FORBIDDEN', message: 'Super admin access required' }, { status: 403 })
    }

    // Get all signed up invites for this campaign
    const signedUpInvites = await prisma.trialInvite.findMany({
      where: {
        campaignId,
        status: 'SIGNED_UP',
        signedUpUserId: { not: null }
      },
      orderBy: { signedUpAt: 'desc' }
    })

    if (signedUpInvites.length === 0) {
      return NextResponse.json({ users: [], total: 0 })
    }

    // Get user IDs
    const userIds = signedUpInvites
      .map(inv => inv.signedUpUserId)
      .filter((id): id is string => id !== null)

    // Fetch user details with activity stats
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      include: {
        // Count patents
        patents: {
          select: { id: true }
        },
        // Count novelty searches
        noveltySearchRuns: {
          select: { id: true, status: true }
        },
        // Count drafting sessions
        draftingSessions: {
          select: { id: true, status: true }
        },
        // Get usage logs for token consumption
        usageLogs: {
          where: {
            startedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
          },
          select: {
            inputTokens: true,
            outputTokens: true,
            modelClass: true
          }
        }
      }
    })

    // Build response with activity stats
    const usersWithStats = signedUpInvites.map(invite => {
      const user = users.find(u => u.id === invite.signedUpUserId)
      
      if (!user) {
        return {
          inviteId: invite.id,
          email: invite.email,
          firstName: invite.firstName,
          lastName: invite.lastName,
          country: invite.country,
          company: invite.company,
          signedUpAt: invite.signedUpAt,
          userId: invite.signedUpUserId,
          userFound: false,
          activity: null
        }
      }

      // Calculate activity stats
      const patentsDrafted = user.patents.length
      const patentsCompleted = user.patents.length // All patents are considered drafted/completed
      const noveltySearches = user.noveltySearchRuns.length
      const completedSearches = user.noveltySearchRuns.filter(s => s.status === 'COMPLETED').length
      const draftingSessions = user.draftingSessions.length

      // Calculate token usage
      const totalInputTokens = user.usageLogs.reduce((sum, log) => sum + (log.inputTokens || 0), 0)
      const totalOutputTokens = user.usageLogs.reduce((sum, log) => sum + (log.outputTokens || 0), 0)

      // Calculate days since signup
      const daysSinceSignup = invite.signedUpAt 
        ? Math.floor((Date.now() - new Date(invite.signedUpAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0

      // Last activity
      const lastActivity = user.updatedAt

      return {
        inviteId: invite.id,
        email: invite.email,
        firstName: invite.firstName || user.firstName,
        lastName: invite.lastName || user.lastName,
        country: invite.country,
        company: invite.company,
        signedUpAt: invite.signedUpAt,
        userId: user.id,
        userFound: true,
        daysSinceSignup,
        lastActivity,
        activity: {
          patentsDrafted,
          patentsCompleted,
          noveltySearches,
          completedSearches,
          draftingSessions,
          totalInputTokens,
          totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          // Engagement score (simple heuristic)
          engagementScore: calculateEngagementScore({
            patentsDrafted,
            noveltySearches,
            draftingSessions,
            daysSinceSignup
          })
        }
      }
    })

    // Summary stats
    const summary = {
      totalSignedUp: usersWithStats.length,
      activeUsers: usersWithStats.filter(u => u.activity && (u.activity.patentsDrafted > 0 || u.activity.noveltySearches > 0)).length,
      totalPatentsDrafted: usersWithStats.reduce((sum, u) => sum + (u.activity?.patentsDrafted || 0), 0),
      totalNoveltySearches: usersWithStats.reduce((sum, u) => sum + (u.activity?.noveltySearches || 0), 0),
      avgEngagementScore: usersWithStats.length > 0 
        ? (usersWithStats.reduce((sum, u) => sum + (u.activity?.engagementScore || 0), 0) / usersWithStats.length).toFixed(1)
        : '0'
    }

    return NextResponse.json({
      users: usersWithStats,
      total: usersWithStats.length,
      summary
    })
  } catch (error) {
    console.error('Get trial users error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to get trial users' },
      { status: 500 }
    )
  }
}

/**
 * Calculate engagement score (0-100)
 */
function calculateEngagementScore(activity: {
  patentsDrafted: number
  noveltySearches: number
  draftingSessions: number
  daysSinceSignup: number
}): number {
  const { patentsDrafted, noveltySearches, draftingSessions, daysSinceSignup } = activity
  
  // Weight factors
  const weights = {
    patents: 30,      // High value action
    searches: 20,     // Medium value action
    sessions: 10,     // Shows exploration
    recency: 40       // How recently they've been active
  }

  // Calculate scores
  let score = 0
  
  // Patent score (max 30 points, 10 points per patent up to 3)
  score += Math.min(patentsDrafted * 10, weights.patents)
  
  // Search score (max 20 points, 5 points per search up to 4)
  score += Math.min(noveltySearches * 5, weights.searches)
  
  // Session score (max 10 points, 2 points per session up to 5)
  score += Math.min(draftingSessions * 2, weights.sessions)
  
  // Recency score (max 40 points, decays over 14 days)
  if (daysSinceSignup <= 14) {
    score += weights.recency * (1 - (daysSinceSignup / 14))
  }

  return Math.round(score)
}

