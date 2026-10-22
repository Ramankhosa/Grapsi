import { NextRequest, NextResponse } from 'next/server'

function isPrivateFundingSource(value: string) {
  try {
    let decoded = value
    for (let step = 0; step < 4; step++) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    const path = new URL(decoded, 'http://catalogue.invalid').pathname.replace(/\/{2,}/g, '/')
    return /^\/uploads\/funding-(?:documents|templates|intake)(?:\/|$)/i.test(path)
  } catch {
    return false // Next rejects malformed URLs before resolving public files.
  }
}

// Next.js middleware - runs on every request
export function middleware(request: NextRequest) {
  // Get the pathname of the request (e.g. /api/users, /dashboard)
  const { pathname } = request.nextUrl

  // Source files are server-side evidence, never public catalogue downloads.
  // Keep existing files in place for parsing, while closing static/image URLs.
  const imageSource = pathname === '/_next/image' ? request.nextUrl.searchParams.get('url') : null
  if (isPrivateFundingSource(pathname) || (imageSource && isPrivateFundingSource(imageSource))) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }

  // Skip middleware for static files, Next.js internals, and public assets
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') || // API routes are already protected individually
    pathname.startsWith('/static/') ||
    pathname.includes('.') // Files with extensions (images, etc.)
  ) {
    return NextResponse.next()
  }

  // Add any global middleware logic here if needed
  // For now, just pass through all requests

  return NextResponse.next()
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|favicon.ico).*)',
  ],
}
