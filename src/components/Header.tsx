'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useEntitlements } from '@/hooks/useEntitlements'
import AnimatedLogo from '@/components/ui/animated-logo'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { FileSearch, FileText, Library, Sparkles } from 'lucide-react'
import NotificationBell from '@/components/notifications/NotificationBell'

/**
 * Two-line menu entry: bold title plus a one-line plain-language description,
 * so an admin can tell what lives behind each link without clicking it.
 */
function MenuItem({
  href,
  icon,
  title,
  description,
  onClick,
}: {
  href: string
  icon: string
  title: string
  description?: string
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      className="flex w-full items-start space-x-2 px-3 py-2 text-left hover:bg-gpt-gray-50"
      onClick={onClick}
    >
      <span className="mt-0.5 text-sm leading-none">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm text-gpt-gray-800">{title}</span>
        {description ? (
          <span className="block text-[11px] leading-snug text-gpt-gray-500">{description}</span>
        ) : null}
      </span>
    </Link>
  )
}

function MenuGroup({ label }: { label: string }) {
  return (
    <>
      <div className="my-1 border-t border-gpt-gray-200"></div>
      <div className="px-3 py-1 text-xs font-semibold uppercase text-gpt-gray-500">{label}</div>
    </>
  )
}

export default function Header() {
  const { user, logout, isLoading } = useAuth()
  const { me: fundingDept } = useFundingDeptMe()
  // Plan-gated product modules: hide nav entries the tenant's plan does not
  // include so users don't click into a 403 (enforcement stays server-side).
  const { hasModule } = useEntitlements()
  const canUseGrantStudio = hasModule('GRANT_STUDIO')
  const canUseFundingIntelligence = hasModule('FUNDING_INTELLIGENCE')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const menuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const platformPermissions = user?.platformPermissions || []
  const isPlatformAdmin = Boolean(user?.roles?.includes('ADMIN') && user?.ati_id === 'PLATFORM')
  const canOpenPlatformFunding =
    Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER') || isPlatformAdmin) ||
    platformPermissions.includes('platform.support.read') ||
    platformPermissions.includes('funding.operations.write') ||
    platformPermissions.includes('funding.publisher.write')

  // Close menu function
  const closeMenu = useCallback(() => {
    setShowUserMenu(false)
  }, [])

  // Clear any pending timeout
  const clearMenuTimeout = useCallback(() => {
    if (menuTimeoutRef.current) {
      clearTimeout(menuTimeoutRef.current)
      menuTimeoutRef.current = null
    }
  }, [])

  // Start auto-close timeout
  const startMenuTimeout = useCallback(() => {
    clearMenuTimeout()
    menuTimeoutRef.current = setTimeout(() => {
      closeMenu()
    }, 4000) // Auto-close after 4 seconds of inactivity
  }, [closeMenu, clearMenuTimeout])

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }

    // Handle escape key to close dropdown
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    // Handle any scroll to close dropdown
    const handleScroll = () => {
      closeMenu()
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscapeKey)
      window.addEventListener('scroll', handleScroll, true)
      // Start auto-close timeout when menu opens
      startMenuTimeout()
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscapeKey)
      window.removeEventListener('scroll', handleScroll, true)
      clearMenuTimeout()
    }
  }, [showUserMenu, closeMenu, startMenuTimeout, clearMenuTimeout])

  // Reset menu state when user changes (after login/logout)
  useEffect(() => {
    closeMenu()
  }, [user?.user_id, closeMenu])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMenuTimeout()
    }
  }, [clearMenuTimeout])

  const handleSignOut = () => {
    closeMenu()
    logout()
  }

  const handlePasswordReset = async () => {
    if (!user?.email || isSendingReset) return
    try {
      setIsSendingReset(true)
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      })
      if (!res.ok) throw new Error('Failed to request reset')
      closeMenu()
      alert('Password reset link sent to ' + user.email)
    } catch (e) {
      console.error('Reset request failed', e)
      alert('Could not send reset email. Please try again.')
    } finally {
      setIsSendingReset(false)
    }
  }

  const handleMenuToggle = () => {
    if (showUserMenu) {
      closeMenu()
    } else {
      setShowUserMenu(true)
    }
  }

  // Reset auto-close timeout when user interacts with menu
  const handleMenuMouseEnter = () => {
    clearMenuTimeout()
  }

  const handleMenuMouseLeave = () => {
    startMenuTimeout()
  }

  if (isLoading) {
    return (
      <header className="bg-white shadow-sm border-b border-gpt-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <AnimatedLogo size="sm" className="flex-shrink-0" useKishoFallback={true} />
              <Link href="/" className="text-xl font-bold text-gpt-gray-900">
                Paper Nest
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gpt-blue-600"></div>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white shadow-sm border-b border-gpt-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <AnimatedLogo size="sm" autoPlayDuration={2000} className="flex-shrink-0" useKishoFallback={true} />
            <Link href="/" className="text-xl font-bold text-gpt-gray-900">
              Paper Nest
            </Link>
          </div>

          {user ? (
            <div className="relative inline-block" ref={userMenuRef}>
              {/* Quick Navigation Links */}
              <div className="flex items-center space-x-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                >
                  🏠 Dashboard
                </Link>

                {canUseFundingIntelligence && (
                  <Link
                    href="/funding/intelligence"
                    className="hidden items-center px-3 py-2 text-sm font-medium text-gpt-gray-700 transition-all duration-200 hover:text-teal-700 lg:inline-flex"
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Funding Intelligence
                  </Link>
                )}

                {/* Shared research library navigation */}
                {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
                  <>
                    <Link
                      href="/library"
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                    >
                      <Library className="w-4 h-4 mr-1" />
                      Library
                    </Link>
                  </>
                )}

                <NotificationBell />

                {/* Compact User Dropdown */}
                <button
                  onClick={handleMenuToggle}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gpt-gray-50 transition-all duration-200 border border-gpt-gray-200"
                  aria-expanded={showUserMenu}
                  aria-haspopup="true"
                >
                  <div className="w-6 h-6 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                    {user.email?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <svg
                    className={`w-3 h-3 text-gpt-gray-500 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Compact User Dropdown Menu */}
              {showUserMenu && (
                <div
                  className="absolute right-0 top-full mt-1 w-80 max-h-[82vh] overflow-y-auto bg-white border border-gpt-gray-200 rounded-lg shadow-lg z-50"
                  onMouseEnter={handleMenuMouseEnter}
                  onMouseLeave={handleMenuMouseLeave}
                >
                  {/* User Info */}
                  <div className="px-3 py-2 border-b border-gpt-gray-200 bg-gpt-gray-50">
                    <div className="text-sm text-gpt-gray-900 font-medium truncate">{user.email}</div>
                    <div className="text-xs text-gpt-gray-600">Role: {user.roles?.join(', ') || 'None'}</div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-1">
                    <Link
                      href="/dashboard"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={closeMenu}
                    >
                      <span>🏠</span>
                      <span>Dashboard</span>
                    </Link>

                    {canUseGrantStudio && (
                      <Link
                        href="/projects"
                        className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                        onClick={closeMenu}
                      >
                        <span>📁</span>
                        <span>Projects</span>
                      </Link>
                    )}

                    {canUseFundingIntelligence && (
                      <Link
                        href="/funding/intelligence"
                        className="flex w-full items-center space-x-2 px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50"
                        onClick={closeMenu}
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>Funding Intelligence</span>
                      </Link>
                    )}

                    {canUseFundingIntelligence && (
                      <Link
                        href="/funding/intelligence/patents"
                        className="flex w-full items-center space-x-2 px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50"
                        onClick={closeMenu}
                      >
                        <FileSearch className="h-4 w-4" />
                        <span>Patent Search</span>
                      </Link>
                    )}

                    <Link
                      href="/assignments"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={closeMenu}
                    >
                      <span>📋</span>
                      <span>Assignments</span>
                    </Link>

                    {/* Shared research library links */}
                    {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
                      <>
                        <Link
                          href="/library"
                          className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                          onClick={closeMenu}
                        >
                          <span>📚</span>
                          <span>Reference Library</span>
                        </Link>
                      </>
                    )}

                    {/* Funding Department — membership, not a role, so it is
                        answered by the server rather than guessed from roles. */}
                    {fundingDept.isMember && (
                      <>
                        <MenuGroup label="Funding Department" />
                        <MenuItem
                          href="/funding-dept"
                          icon="🧭"
                          title="My Worklist"
                          description="Deadlines, follow-ups due and open calls in your schools"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/queue"
                          icon="🧪"
                          title="My Schools&rsquo; Calls"
                          description="Open calls matching your schools&rsquo; disciplines, and what is still unassigned"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/chase"
                          icon="⏰"
                          title="Chase Queue"
                          description="Everything overdue, unanswered or gone quiet, worst first"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/assignments"
                          icon="🗂️"
                          title="Calls I Assigned"
                          description="Track, chase and update the assignments you handed out"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/faculty"
                          icon="🎓"
                          title="Faculty in My Schools"
                          description="Directory of the faculty your coverage lets you assign to"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/researcher-matching"
                          icon="🎯"
                          title="Find Researchers"
                          description="Match faculty to a funding call and assign or circulate it"
                          onClick={closeMenu}
                        />
                        {fundingDept.isHead && (
                          <>
                            <MenuItem
                              href="/funding-dept/overview"
                              icon="📋"
                              title="Department Overview"
                              description="Each member's workload, school coverage and gaps"
                              onClick={closeMenu}
                            />
                            <MenuItem
                              href="/funding-dept/calls"
                              icon="📈"
                              title="Call Funnel"
                              description="Every call with matched, assigned and submitted counts"
                              onClick={closeMenu}
                            />
                          </>
                        )}
                      </>
                    )}

                    {/* Quality Audit for auditors who are not admins — admins get
                        it inside the Administration group below. */}
                    {user.roles?.includes('QUALITY_AUDITOR' as any) &&
                      !user.roles?.includes('OWNER') &&
                      !user.roles?.includes('ADMIN') && (
                        <>
                          <div className="border-t border-gpt-gray-200 my-1"></div>
                          <MenuItem
                            href="/quality-audit"
                            icon="🔍"
                            title="Quality Audit"
                            description="Review AI output quality across the organization's projects"
                            onClick={closeMenu}
                          />
                        </>
                      )}

                    {/* Administration — every tenant-admin surface in one labeled
                        group, each with a plain-language description of what it
                        does. OWNER/ADMIN see everything; CALL_ADMIN sees the
                        scoped surfaces (faculty/org tree, matching, calls). */}
                    {(user.roles?.includes('OWNER') || user.roles?.includes('ADMIN') || user.roles?.includes('CALL_ADMIN' as any)) && (
                      <>
                        <MenuGroup label="Administration" />
                        {(user.roles?.includes('OWNER') || user.roles?.includes('ADMIN')) && (
                          <>
                            <MenuItem
                              href="/tenant-admin/users"
                              icon="👥"
                              title="User Management"
                              description="Create accounts, change roles and issue activation links"
                              onClick={closeMenu}
                            />
                            <MenuItem
                              href="/admin"
                              icon="✉️"
                              title="Invite Members"
                              description="Send email invitations for one-off or external people"
                              onClick={closeMenu}
                            />
                            <MenuItem
                              href="/tenant-admin/teams"
                              icon="🏢"
                              title="Team Management"
                              description="Group people into teams and control what each team can use"
                              onClick={closeMenu}
                            />
                          </>
                        )}
                        <MenuItem
                          href="/tenant-admin/faculty"
                          icon="🎓"
                          title="Faculty & Organization"
                          description="Build the school/department tree and import the faculty roster"
                          onClick={closeMenu}
                        />
                        {(user.roles?.includes('OWNER') || user.roles?.includes('ADMIN')) && (
                          <MenuItem
                            href="/tenant-admin/funding-dept"
                            icon="🧭"
                            title="Funding Department"
                            description="Staff the sponsored-research office and assign each member schools"
                            onClick={closeMenu}
                          />
                        )}
                        <MenuItem
                          href="/funding/imports"
                          icon="📥"
                          title="Import Funding Calls"
                          description="Upload call documents or URLs into your organization's catalog"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/overview"
                          icon="📋"
                          title="Department Overview"
                          description="Pendency, load and coverage — by member and by school"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/funding-dept/calls"
                          icon="📈"
                          title="Call Funnel"
                          description="Every call with who it reached: matched, assigned, submitted, awarded"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/researcher-matching"
                          icon="🎯"
                          title="Find Researchers"
                          description="Match faculty to a funding call, then assign or bulk-circulate it"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/tenant-admin/grant-dashboard"
                          icon="📊"
                          title="Grant Dashboard"
                          description="Allocation, deadlines, outcomes and downloadable CSV reports"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/tenant-admin/analytics"
                          icon="📉"
                          title="Usage Analytics"
                          description="Who is using which service, and how much"
                          onClick={closeMenu}
                        />
                        {(user.roles?.includes('OWNER') || user.roles?.includes('ADMIN')) && (
                          <MenuItem
                            href="/quality-audit"
                            icon="🔍"
                            title="Quality Audit"
                            description="Review AI output quality across the organization's projects"
                            onClick={closeMenu}
                          />
                        )}
                      </>
                    )}

                    {/* Platform staff */}
                    {canOpenPlatformFunding && (
                      <>
                        <MenuGroup
                          label={user.roles?.includes('SUPER_ADMIN') ? 'Platform Admin' : 'Platform Funding'}
                        />
                        <MenuItem
                          href="/super-admin/funding"
                          icon="💼"
                          title="Funding Control"
                          description="Platform-wide call intake, catalog curation and publishing"
                          onClick={closeMenu}
                        />
                      </>
                    )}

                    {user.roles?.includes('SUPER_ADMIN') && (
                      <>
                        {!canOpenPlatformFunding && (
                          <>
                            <MenuGroup label="Platform Admin" />
                            <MenuItem
                              href="/super-admin/funding"
                              icon="💼"
                              title="Funding Control"
                              description="Platform-wide call intake, catalog curation and publishing"
                              onClick={closeMenu}
                            />
                          </>
                        )}
                        <MenuItem
                          href="/super-admin/jurisdiction-config"
                          icon="🏗️"
                          title="Jurisdiction Config"
                          description="Per-country drafting rules and requirements"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/super-admin/countries"
                          icon="🌍"
                          title="Country Profiles"
                          description="Import and activate country jurisdiction profiles"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/super-admin/section-prompts"
                          icon="📝"
                          title="Section Prompts"
                          description="Prompt templates behind each generated section"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/super-admin/jurisdiction-styles"
                          icon="🎨"
                          title="Jurisdiction Styles"
                          description="Formatting and style rules per jurisdiction"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/super-admin/llm-config"
                          icon="🤖"
                          title="LLM Model Control"
                          description="Which AI model runs each stage, and its settings"
                          onClick={closeMenu}
                        />
                        <MenuGroup label="Paper Writing Admin" />
                        <MenuItem
                          href="/admin/paper-types"
                          icon="📑"
                          title="Paper Types"
                          description="Manage the catalog of paper types authors can pick"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/admin/citation-styles"
                          icon="📚"
                          title="Citation Styles"
                          description="Citation formats available in the writing tools"
                          onClick={closeMenu}
                        />
                        <MenuItem
                          href="/admin/publication-venues"
                          icon="🏛️"
                          title="Publication Venues"
                          description="Journals and conferences authors can target"
                          onClick={closeMenu}
                        />
                      </>
                    )}

                    {/* Separator */}
                    <div className="border-t border-gpt-gray-200 my-1"></div>

                    <Link
                      href="/personas"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={closeMenu}
                    >
                      <span>✍️</span>
                      <span>Writing Personas</span>
                    </Link>
                    <button
                      onClick={handlePasswordReset}
                      disabled={isSendingReset}
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2 disabled:opacity-50"
                    >
                      <span>🔒</span>
                      <span>{isSendingReset ? 'Sending reset link…' : 'Reset Password'}</span>
                    </button>

                    <button
                      onClick={handleSignOut}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                    >
                      <span>🚪</span>
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Sign In
              </Link>

              <Link
                href="/register"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
