import { Suspense } from 'react'
import MyGrantsPage from '@/components/funding/MyGrantsPage'
export const metadata = { title: 'My grants', description: 'Your favourite grants, private notes, calendar and email reminders.' }
export default function Page() {
  return <Suspense fallback={<p className="p-8 text-sm text-slate-500">Loading your grants…</p>}><MyGrantsPage /></Suspense>
}
