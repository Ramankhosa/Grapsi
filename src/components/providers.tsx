'use client'

import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/components/ui/toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ToastProvider>
  )
}

// Note: Next.js 13+ automatically provides navigation context
// No need to manually add NavigationProvider

