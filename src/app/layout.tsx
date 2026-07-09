import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Providers } from '@/components/providers'
import AppChrome from '@/components/AppChrome'
import './globals.css'

const inter = localFont({
  src: './fonts/Inter-latin.woff2',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
  preload: true,
})

const cormorant = localFont({
  src: './fonts/CormorantGaramond-Regular.woff2',
  display: 'swap',
  variable: '--font-cormorant',
  preload: true,
})

export const metadata: Metadata = {
  title: 'Paper Nest.ai - "Where Ideas Hatch Into Patents"',
  description: 'Draft, validate, and protect inventions - effortlessly, intelligently, and globally. AI-powered patent writing for innovators.',
  icons: {
    icon: '/animations/logo-video.gif',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${cormorant.variable} bg-gpt-gray-50 min-h-screen`}>
        <Providers>
          <AppChrome>{children}</AppChrome>
        </Providers>
      </body>
    </html>
  )
}
