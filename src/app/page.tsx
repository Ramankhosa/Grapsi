import type { Metadata } from 'next'
import AIGrantMentorHomePage from '@/components/home/AIGrantMentorHomePage'

export const metadata: Metadata = {
  title: 'AI Grant Suite - Find, Write, Perfect Your Grant Proposals',
  description:
    'AI Grant Suite combines Grant Finder, Grant Mentor, and Grant Reviewer to transform your research funding journey from start to finish.',
}

export default function HomePage() {
  return <AIGrantMentorHomePage />
}
