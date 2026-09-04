import type { Metadata } from 'next'
import localFont from 'next/font/local'
import HomeV2Page from '@/components/home-v2/HomeV2Page'

const inter = localFont({
  src: './fonts/Inter-latin.woff2',
  display: 'swap',
  variable: '--font-home-v2-sans',
})

const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-latin.woff2',
  display: 'swap',
  variable: '--font-home-v2-mono',
})

const TITLE = 'AIGrantMentor — The grants you can actually win, found for you'
const DESCRIPTION =
  'AIGrantMentor reads your papers, matches you to live calls from ANRF, DST, DBT, ICMR and 1,000+ funding agencies and opportunities a year, alerts you on WhatsApp the day one opens, and scores your draft against the agency’s own rubric before you submit.'

export const metadata: Metadata = {
  // `absolute` opts out of the root layout's "%s | AIGrantMentor" template,
  // which would otherwise append the brand to a title that already carries it.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'AIGrantMentor',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function HomePage() {
  return (
    <div className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <HomeV2Page />
    </div>
  )
}
