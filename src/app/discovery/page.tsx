import type { Metadata } from 'next'
import ResearchDiscovery from '@/components/discovery/ResearchDiscovery'

export const metadata: Metadata = { title: 'Research Discovery' }
export default function DiscoveryPage() { return <ResearchDiscovery /> }
