import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import HomeV2Page from '@/components/home-v2/HomeV2Page'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-home-v2-sans',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-home-v2-serif',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
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
    <div className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}>
      <HomeV2Page />
    </div>
  )
}
