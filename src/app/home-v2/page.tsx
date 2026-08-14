import type { Metadata } from 'next'
import localFont from 'next/font/local'
import HomeV2Page from '@/components/home-v2/HomeV2Page'

const inter = localFont({
  src: '../fonts/Inter-latin.woff2',
  display: 'swap',
  variable: '--font-home-v2-sans',
})

const jetbrainsMono = localFont({
  src: '../fonts/JetBrainsMono-latin.woff2',
  display: 'swap',
  variable: '--font-home-v2-mono',
})

export const metadata: Metadata = {
  title: 'AIGrantMentor - Funding Intelligence Platform',
  description:
    'AIGrantMentor turns funding records, calls, and reviewer criteria into a command center for research funding.',
}

export default function HomeV2Route() {
  return (
    <div className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <HomeV2Page />
    </div>
  )
}
