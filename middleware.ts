import { NextRequest, NextResponse } from 'next/server'

// Next.js middleware - runs on every request
export function middleware(request: NextRequest) {
  // Get the pathname of the request (e.g. /api/users, /dashboard)
  const { pathname } = request.nextUrl

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
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
