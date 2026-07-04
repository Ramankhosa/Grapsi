'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideHeader = pathname === '/' || pathname === '/home-v2'

  return (
    <>
      {!hideHeader && <Header />}
      {children}
    </>
  )
}
