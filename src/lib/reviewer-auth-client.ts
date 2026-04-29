'use client'

import { useAuth } from '@/lib/auth-context'

export function useReviewerSession() {
  const { user, isLoading } = useAuth()

  return {
    data: user
      ? {
          user: {
            id: user.user_id,
            email: user.email,
            name: user.email,
          },
        }
      : null,
    status: isLoading ? 'loading' : user ? 'authenticated' : 'unauthenticated',
  } as const
}
