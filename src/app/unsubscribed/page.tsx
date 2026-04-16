'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function UnsubscribedContent() {
  const searchParams = useSearchParams()
  const success = searchParams?.get('success')
  const error = searchParams?.get('error')

  return (
    <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950 px-4">
      <div className="max-w-md w-full text-center">
        {success ? (
          <>
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">You&apos;ve Been Unsubscribed</h1>
            <p className="text-ai-graphite-400 mb-8">
              You will no longer receive trial invitation emails from us. 
              If you change your mind, you can always contact us to resubscribe.
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">Unsubscribe Failed</h1>
            <p className="text-ai-graphite-400 mb-8">
              {error === 'invalid' && 'Invalid unsubscribe link.'}
              {error === 'not_found' && 'This invitation was not found.'}
              {error === 'failed' && 'Something went wrong. Please try again later.'}
              {!error && 'An error occurred while processing your request.'}
            </p>
          </>
        )}
        
        <Link
          href="/"
          className="inline-flex items-center px-6 py-3 border border-ai-graphite-700 rounded-lg text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
        >
          ← Go to Homepage
        </Link>
      </div>
    </div>
  )
}

export default function UnsubscribedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <UnsubscribedContent />
    </Suspense>
  )
}

