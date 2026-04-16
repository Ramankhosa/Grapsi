import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createAuditLog, decryptToken } from '@/lib/auth'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'

// Import token revelation functions (we need to replicate them since they're not exported)
function generateATIToken() {
  return require('crypto').randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token: string) {
  return require('bcryptjs').hashSync(token, 12)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check platform scope access - only super admin can reveal tokens
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const tokenId = params.id

    // Get token with tenant info
    const token = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: { tenant: true }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    // Security check: Don't allow revealing platform tokens (super admin tokens)
    if (token.tenant?.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Platform tokens cannot be revealed for security reasons' },
        { status: 403 }
      )
    }

    // Check if raw token is available and not expired
    if (!token.rawToken || !token.rawTokenExpiry) {
      return NextResponse.json(
        {
          code: 'NOT_AVAILABLE',
          message: 'Raw token is not available for revelation. Token may be too old or was created before revelation was implemented.',
          suggestion: 'Create a new token for the tenant instead.'
        },
        { status: 410 }
      )
    }

    // Check if raw token has expired
    if (new Date() > token.rawTokenExpiry) {
      return NextResponse.json(
        {
          code: 'EXPIRED',
          message: 'Raw token revelation period has expired for security reasons.',
          suggestion: 'Create a new token for the tenant instead.'
        },
        { status: 410 }
      )
    }

    // Check if the token has been revealed recently (within last 24 hours)
    const recentReveal = await prisma.auditLog.findFirst({
      where: {
        resource: `ati_token:${tokenId}`,
        action: 'TOKEN_REVEALED',
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      }
    })

    if (recentReveal) {
      return NextResponse.json(
        {
          code: 'RATE_LIMITED',
          message: 'Token was recently revealed. For security, tokens can only be revealed once every 24 hours.',
          last_revealed: recentReveal.createdAt.toISOString(),
          next_available: new Date(recentReveal.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
        },
        { status: 429 }
      )
    }

    // Decrypt the raw token
    console.log('🔐 Attempting to decrypt token for:', token.fingerprint);
    console.log('Raw token exists:', !!token.rawToken);
    console.log('Raw token length:', token.rawToken?.length);

    const revealedToken = decryptToken(token.rawToken)
    console.log('Decryption result:', revealedToken ? 'SUCCESS' : 'FAILED');

    if (!revealedToken) {
      console.log('Raw token value (first 50 chars):', token.rawToken?.substring(0, 50));
      console.log('Token created at:', token.createdAt);

      // For tokens created before the encryption feature, suggest creating a new one
      const isOldToken = token.createdAt < new Date('2025-09-27');

      return NextResponse.json(
        {
          code: 'DECRYPTION_FAILED',
          message: isOldToken
            ? 'This token was created before the revelation feature was implemented. Please create a new token for the tenant.'
            : 'Failed to decrypt token. This may be due to key mismatch or corruption.',
          suggestion: 'Create a new token for the tenant instead.',
          debug: {
            hasRawToken: !!token.rawToken,
            rawTokenLength: token.rawToken?.length,
            fingerprint: token.fingerprint,
            createdAt: token.createdAt,
            isOldToken
          }
        },
        { status: isOldToken ? 410 : 500 }
      )
    }

    // Audit log the revelation
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: token.tenantId || undefined,
      action: 'TOKEN_REVEALED',
      resource: `ati_token:${tokenId}`,
      ip,
      meta: {
        fingerprint: token.fingerprint,
        tenant_ati_id: token.tenant?.atiId,
        revelation_reason: 'Super admin token recovery'
      }
    })

    return NextResponse.json({
      token: revealedToken,
      fingerprint: token.fingerprint,
      warning: "This token will be shown only once. Copy it now and store securely. For security reasons, this token revelation has been logged.",
      expires_at: token.rawTokenExpiry.toISOString(),
      tenant: token.tenant ? {
        name: token.tenant.name,
        ati_id: token.tenant.atiId
      } : null
    })

  } catch (error) {
    console.error('Token reveal error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to reveal token' },
      { status: 500 }
    )
  }
}
