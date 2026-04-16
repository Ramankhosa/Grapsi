import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Replacement for NextAuth getServerSession
 * Authenticates user from JWT token in Authorization header
 */
export async function authenticateUser(request: NextRequest): Promise<{
  user: any
  error: { code: string; message: string; status: number } | null
}> {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        user: null,
        error: {
          code: 'NO_TOKEN',
          message: 'Session missing or expired. Please log in again.',
          status: 401
        }
      }
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return {
        user: null,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Session expired or invalid. Please log in again.',
          status: 401
        }
      }
    }

    // Get full user data from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true }
    })

    if (!user) {
      return {
        user: null,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found. Please log in again.',
          status: 401
        }
      }
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      return {
        user: null,
        error: {
          code: 'USER_SUSPENDED',
          message: 'User account is suspended.',
          status: 401
        }
      }
    }

    // For non-social login users, validate ATI token
    if (!user.oauthProvider && !user.signupAtiTokenId) {
      return {
        user: null,
        error: {
          code: 'MISSING_SIGNUP_TOKEN',
          message: 'User signup ATI token not found.',
          status: 401
        }
      }
    }

    // Check tenant status if user has a tenant
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return {
        user: null,
        error: {
          code: 'TENANT_INACTIVE',
          message: 'Tenant is not active.',
          status: 401
        }
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        tenantId: user.tenantId,
        tenant: user.tenant
      },
      error: null
    }
  } catch (error) {
    return {
      user: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed. Please log in again.',
        status: 401
      }
    }
  }
}

