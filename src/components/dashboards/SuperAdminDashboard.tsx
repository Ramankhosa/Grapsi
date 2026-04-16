'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'

interface Tenant {
  id: string
  name: string
  ati_id: string
  status: string
  user_count: number
  ati_token_count: number
  created_at: string
}

interface NavItem {
  label: string
  icon: string
  href?: string
  action?: () => void
  badge?: string
}

interface NavGroup {
  title: string
  icon: string
  items: NavItem[]
}

interface PlatformPaperAnalytics {
  totalPapers: number
  papersTrend: Array<{ month: string; count: number }>
  paperTypesPopularity: Array<{ type: string; count: number }>
  citationStylesUsage: Array<{ style: string; count: number }>
  literatureSearchUsage: {
    totalSearches: number
    apiUsage: Record<string, number>
  }
  averageCitationsByType: Array<{ type: string; averageCitations: number }>
}

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateTenant, setShowCreateTenant] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [isCheckingNotifications, setIsCheckingNotifications] = useState(false)
  const [notificationStatus, setNotificationStatus] = useState<{
    expiringTokensCount: number
    tokens: any[]
  } | null>(null)
  const [createdTokenInfo, setCreatedTokenInfo] = useState<{
    token: string
    fingerprint: string
    tenantName: string
  } | null>(null)
  const [newTenant, setNewTenant] = useState({
    name: '',
    atiId: '',
    generateInitialToken: true,
    expires_at: '',
    max_uses: '',
    plan_tier: 'BASIC',
    notes: 'Initial tenant onboarding token'
  })
  const [isCreating, setIsCreating] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    analytics: true,
    ai: true,
    paper: true,
    access: true
  })
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Paper analytics state
  const [paperAnalytics, setPaperAnalytics] = useState<PlatformPaperAnalytics | null>(null)
  const [isLoadingPapers, setIsLoadingPapers] = useState(false)

  // Handle clicks outside user menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      // Auto-close after 5 seconds of inactivity
      const timeout = setTimeout(() => setShowUserMenu(false), 5000)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        clearTimeout(timeout)
      }
    }
  }, [showUserMenu])

  useEffect(() => {
    fetchTenants()
    fetchPaperAnalytics()
  }, [])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/v1/platform/tenants', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setTenants(data)
      }
    } catch (error) {
      console.error('Failed to fetch tenants:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchPaperAnalytics = async () => {
    if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) return

    try {
      setIsLoadingPapers(true)
      const response = await fetch('/api/super-admin/analytics/papers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPaperAnalytics(data)
      }
    } catch (error) {
      console.error('Failed to fetch paper analytics:', error)
    } finally {
      setIsLoadingPapers(false)
    }
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTenant.name.trim() || !newTenant.atiId.trim()) {
      alert('Please fill in all fields')
      return
    }

    setIsCreating(true)

    try {
      const requestBody: any = {
        name: newTenant.name.trim(),
        atiId: newTenant.atiId.trim().toUpperCase(),
        generateInitialToken: true
      }

      if (newTenant.generateInitialToken) {
        const initialTokenConfig: any = {}

        if (newTenant.expires_at && newTenant.expires_at.trim()) {
          initialTokenConfig.expires_at = newTenant.expires_at.trim()
        }

        if (newTenant.max_uses && newTenant.max_uses.trim()) {
          initialTokenConfig.max_uses = parseInt(newTenant.max_uses.trim())
        }

        if (newTenant.plan_tier && newTenant.plan_tier.trim()) {
          initialTokenConfig.plan_tier = newTenant.plan_tier.trim()
        }

        if (newTenant.notes && newTenant.notes.trim()) {
          initialTokenConfig.notes = newTenant.notes.trim()
        }

        if (Object.keys(initialTokenConfig).length > 0) {
          requestBody.initialTokenConfig = initialTokenConfig
        }
      }

      const response = await fetch('/api/v1/platform/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (response.ok) {
        setShowCreateTenant(false)
        setNewTenant({
          name: '',
          atiId: '',
          generateInitialToken: true,
          expires_at: '',
          max_uses: '',
          plan_tier: 'BASIC',
          notes: 'Initial tenant onboarding token'
        })
        fetchTenants()

        if (data.initial_token) {
          setCreatedTokenInfo({
            token: data.initial_token.token_display_once,
            fingerprint: data.initial_token.fingerprint,
            tenantName: data.name
          })
          setShowSuccessModal(true)
        }
      } else {
        alert(data.message || 'Failed to create tenant')
      }
    } catch (error) {
      console.error('Failed to create tenant:', error)
      alert('Failed to create tenant')
    } finally {
      setIsCreating(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }

  const totalUsers = tenants.reduce((sum, tenant) => sum + tenant.user_count, 0)
  const totalTokens = tenants.reduce((sum, tenant) => sum + tenant.ati_token_count, 0)

  const checkExpiryNotifications = async () => {
    try {
      const response = await fetch('/api/v1/admin/expiry-notifications', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setNotificationStatus(data)
      } else {
        alert('Failed to check expiry notifications')
      }
    } catch (error) {
      console.error('Failed to check expiry notifications:', error)
      alert('Failed to check expiry notifications')
    }
  }

  const triggerExpiryNotifications = async () => {
    if (!confirm('This will send expiry notifications to all users with tokens expiring within 7 days. Continue?')) {
      return
    }

    setIsCheckingNotifications(true)
    try {
      const response = await fetch('/api/v1/admin/expiry-notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        alert('Expiry notifications sent successfully!')
        await checkExpiryNotifications()
      } else {
        const error = await response.json()
        alert(error.message || 'Failed to send expiry notifications')
      }
    } catch (error) {
      console.error('Failed to trigger expiry notifications:', error)
      alert('Failed to trigger expiry notifications')
    } finally {
      setIsCheckingNotifications(false)
    }
  }

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  // Navigation structure
  const navGroups: NavGroup[] = [
    {
      title: 'Analytics & Monitoring',
      icon: '📊',
      items: [
        { label: 'Platform Analytics', icon: '📈', href: '/super-admin/analytics' },
        { label: 'User Service Usage', icon: '👥', href: '/super-admin/user-service-usage' },
        { label: 'Quota Controller', icon: '⚡', href: '/super-admin/quota-controller' }
      ]
    },
    {
      title: 'AI & LLM Settings',
      icon: '🤖',
      items: [
        { label: 'LLM Model Control', icon: '🧠', href: '/super-admin/llm-config', badge: 'NEW' },
        { label: 'Model Costs', icon: '💰', href: '/super-admin/model-costs' }
      ]
    },
    {
      title: 'Paper Writing',
      icon: '📄',
      items: [
        { label: 'Section Prompts', icon: '📝', href: '/super-admin/paper-prompts', badge: 'NEW' },
        { label: 'Paper Types', icon: '📑', href: '/admin/paper-types' },
        { label: 'Citation Styles', icon: '📚', href: '/admin/citation-styles' },
        { label: 'Publication Venues', icon: '🏛️', href: '/admin/publication-venues' }
      ]
    },
    {
      title: 'Access Management',
      icon: '🔐',
      items: [
        { label: 'Trial Campaigns', icon: '📧', href: '/super-admin/trial-campaigns', badge: 'NEW' },
        { label: 'ATI Token Management', icon: '🎟️', href: '/ati-management' },
        { label: 'Service Control', icon: '🎛️', href: '/super-admin/service-control' }
      ]
    }
    // Patent-specific settings hidden - use direct URLs if needed:
    // /super-admin/jurisdiction-config, /super-admin/countries, 
    // /super-admin/section-prompts, /super-admin/jurisdiction-styles,
    // /super-admin/superset-sections
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-slate-900/95 backdrop-blur-xl border-r border-slate-700/50 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
        {/* Logo Area */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-700/50">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">SA</span>
              </div>
              <span className="font-semibold text-white">Super Admin</span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <svg className={`w-5 h-5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {/* Quick Actions */}
          <button
            onClick={() => setShowCreateTenant(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-medium hover:from-emerald-600 hover:to-teal-600 transition-all shadow-lg shadow-emerald-500/20 ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {!sidebarCollapsed && <span>Create Tenant</span>}
          </button>

          <div className="pt-4 space-y-1">
            {navGroups.map((group, groupIndex) => (
              <div key={group.title} className="mb-2">
                {!sidebarCollapsed ? (
                  <>
                    <button
                      onClick={() => toggleGroup(['analytics', 'ai', 'paper', 'access'][groupIndex])}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span>{group.icon}</span>
                        <span>{group.title}</span>
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${expandedGroups[['analytics', 'ai', 'paper', 'access'][groupIndex]] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedGroups[['analytics', 'ai', 'paper', 'access'][groupIndex]] && (
                      <div className="mt-1 space-y-0.5">
                        {group.items.map((item) => (
                          <button
                            key={item.label}
                            onClick={() => item.href ? router.push(item.href) : item.action?.()}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/70 transition-all group"
                          >
                            <span className="flex items-center gap-3">
                              <span className="text-base">{item.icon}</span>
                              <span className="text-sm">{item.label}</span>
                            </span>
                            {item.badge && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white">
                                {item.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <button
                        key={item.label}
                        onClick={() => item.href ? router.push(item.href) : item.action?.()}
                        className="w-full flex items-center justify-center p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                        title={item.label}
                      >
                        <span className="text-lg">{item.icon}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>

        {/* User Profile */}
        <div className="border-t border-slate-700/50 p-3" ref={userMenuRef}>
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-800 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-semibold">
                {user?.email?.charAt(0)?.toUpperCase() || 'S'}
              </div>
              {!sidebarCollapsed && (
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-white truncate max-w-[140px]">{user?.email}</div>
                  <div className="text-xs text-slate-400">Super Admin</div>
                </div>
              )}
            </button>

            {/* User Dropdown */}
            {showUserMenu && (
              <div className={`absolute bottom-full mb-2 ${sidebarCollapsed ? 'left-full ml-2' : 'left-0 right-0'} bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden min-w-[200px]`}>
                <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
                  <div className="text-sm font-medium text-white truncate">{user?.email}</div>
                  <div className="text-xs text-slate-400 mt-0.5">Platform Administrator</div>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { router.push('/dashboard'); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
                  >
                    <span>🏠</span>
                    <span>Main Dashboard</span>
                  </button>
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <span>🚪</span>
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`transition-all duration-300 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Top Bar */}
        <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50">
          <div className="flex items-center justify-between h-16 px-6">
            <div>
              <h1 className="text-xl font-bold text-white">Platform Overview</h1>
              <p className="text-sm text-slate-400">Monitor and manage your entire platform</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={checkExpiryNotifications}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
              >
                <span>🔔</span>
                <span className="text-sm">Check Notifications</span>
              </button>
            </div>
          </div>
        </header>

        <div className="p-6 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Tenants */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <span className="text-xl">🏢</span>
                  </div>
                  <span className="text-sm font-medium text-blue-300">Total Tenants</span>
                </div>
                <div className="text-3xl font-bold text-white">{tenants.length}</div>
                <div className="text-sm text-slate-400 mt-1">Organizations registered</div>
              </div>
            </div>

            {/* Total Users */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-xl">👥</span>
                  </div>
                  <span className="text-sm font-medium text-emerald-300">Total Users</span>
                </div>
                <div className="text-3xl font-bold text-white">{totalUsers}</div>
                <div className="text-sm text-slate-400 mt-1">Active platform users</div>
              </div>
            </div>

            {/* ATI Tokens */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                    <span className="text-xl">🎟️</span>
                  </div>
                  <span className="text-sm font-medium text-violet-300">ATI Tokens</span>
                </div>
                <div className="text-3xl font-bold text-white">{totalTokens}</div>
                <div className="text-sm text-slate-400 mt-1">Access tokens issued</div>
              </div>
            </div>

            {/* Active Tenants */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <span className="text-xl">✅</span>
                  </div>
                  <span className="text-sm font-medium text-amber-300">Active Tenants</span>
                </div>
                <div className="text-3xl font-bold text-white">{tenants.filter(t => t.status === 'ACTIVE').length}</div>
                <div className="text-sm text-slate-400 mt-1">Currently active</div>
              </div>
            </div>
          </div>

          {/* Paper Analytics (when feature enabled) */}
          {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 p-5">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                      <span className="text-xl">📄</span>
                    </div>
                    <span className="text-sm font-medium text-purple-300">Total Papers</span>
                  </div>
                  <div className="text-3xl font-bold text-white">
                    {isLoadingPapers ? '...' : (paperAnalytics?.totalPapers || 0)}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">Across all tenants</div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border border-cyan-500/20 p-5">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                      <span className="text-xl">🔍</span>
                    </div>
                    <span className="text-sm font-medium text-cyan-300">Literature Searches</span>
                  </div>
                  <div className="text-3xl font-bold text-white">
                    {isLoadingPapers ? '...' : (paperAnalytics?.literatureSearchUsage?.totalSearches || 0)}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">Academic database queries</div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-pink-500/10 to-pink-600/5 border border-pink-500/20 p-5">
                <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center">
                      <span className="text-xl">📊</span>
                    </div>
                    <span className="text-sm font-medium text-pink-300">Citation Styles</span>
                  </div>
                  <div className="text-3xl font-bold text-white">
                    {isLoadingPapers ? '...' : (paperAnalytics?.citationStylesUsage?.length || 0)}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">Styles in use</div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border border-indigo-500/20 p-5">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                      <span className="text-xl">📈</span>
                    </div>
                    <span className="text-sm font-medium text-indigo-300">Avg Citations/Paper</span>
                  </div>
                  <div className="text-3xl font-bold text-white">
                    {isLoadingPapers ? '...' : (
                      paperAnalytics?.averageCitationsByType?.length
                        ? (paperAnalytics.averageCitationsByType.reduce((sum, item) => sum + item.averageCitations, 0) / paperAnalytics.averageCitationsByType.length).toFixed(1)
                        : '0.0'
                    )}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">Platform average</div>
                </div>
              </div>
            </>
          )}

          {/* Expiry Notifications */}
          {notificationStatus && (
            <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                    <span className="text-xl">⏰</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Expiring Tokens</h3>
                    <p className="text-sm text-slate-400">
                      {notificationStatus.expiringTokensCount} token{notificationStatus.expiringTokensCount !== 1 ? 's' : ''} expiring within 7 days
                    </p>
                  </div>
                </div>
                <button
                  onClick={triggerExpiryNotifications}
                  disabled={isCheckingNotifications}
                  className="px-4 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {isCheckingNotifications ? 'Sending...' : 'Send Notifications'}
                </button>
              </div>

              {notificationStatus.tokens.length > 0 && (
                <div className="p-4 space-y-2">
                  {notificationStatus.tokens.slice(0, 5).map((token: any) => (
                    <div key={token.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          token.daysUntilExpiry <= 3 ? 'bg-red-500' :
                          token.daysUntilExpiry <= 7 ? 'bg-amber-500' : 'bg-slate-500'
                        }`} />
                        <div>
                          <div className="text-sm font-medium text-white">{token.fingerprint}</div>
                          <div className="text-xs text-slate-400">{token.tenantName} • Expires in {token.daysUntilExpiry} days</div>
                        </div>
                      </div>
                      <div className="text-sm text-slate-400">
                        {new Date(token.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Paper Analytics Details (when feature enabled) */}
          {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && paperAnalytics && (
            <>
              {/* Paper Types and Citation Styles */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-700/50">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <span className="text-xl">📄</span>
                      Paper Types Popularity
                    </h3>
                    <p className="text-sm text-slate-400">Most used paper types across the platform</p>
                  </div>
                  <div className="p-6">
                    <div className="space-y-3">
                      {paperAnalytics.paperTypesPopularity?.slice(0, 5).map((type, index) => (
                        <div key={type.type} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                              index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                              index === 1 ? 'bg-slate-500/20 text-slate-400' :
                              index === 2 ? 'bg-orange-500/20 text-orange-400' :
                              'bg-slate-600/20 text-slate-500'
                            }`}>
                              {index + 1}
                            </div>
                            <span className="text-sm text-slate-300">{type.type}</span>
                          </div>
                          <span className="text-sm font-medium text-white">{type.count}</span>
                        </div>
                      )) || <p className="text-sm text-slate-500">No data available</p>}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-700/50">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <span className="text-xl">📝</span>
                      Citation Styles Usage
                    </h3>
                    <p className="text-sm text-slate-400">Citation formatting preferences</p>
                  </div>
                  <div className="p-6">
                    <div className="space-y-3">
                      {paperAnalytics.citationStylesUsage?.slice(0, 5).map((style, index) => (
                        <div key={style.style} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                              index === 0 ? 'bg-blue-500/20 text-blue-400' :
                              index === 1 ? 'bg-green-500/20 text-green-400' :
                              index === 2 ? 'bg-purple-500/20 text-purple-400' :
                              'bg-slate-600/20 text-slate-500'
                            }`}>
                              {index + 1}
                            </div>
                            <span className="text-sm text-slate-300">{style.style}</span>
                          </div>
                          <span className="text-sm font-medium text-white">{style.count}</span>
                        </div>
                      )) || <p className="text-sm text-slate-500">No data available</p>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Literature Search API Usage */}
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-700/50">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <span className="text-xl">🔍</span>
                    Literature Search API Usage
                  </h3>
                  <p className="text-sm text-slate-400">Academic database API consumption</p>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {paperAnalytics.literatureSearchUsage?.apiUsage && Object.entries(paperAnalytics.literatureSearchUsage.apiUsage).map(([api, count]) => (
                      <div key={api} className="text-center p-4 rounded-xl bg-slate-900/50 border border-slate-700/50">
                        <div className="text-2xl font-bold text-white">{count.toLocaleString()}</div>
                        <div className="text-sm text-slate-400 capitalize">{api.replace('_', ' ')}</div>
                      </div>
                    )) || (
                      <div className="col-span-full text-center text-slate-500 py-8">
                        No API usage data available
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Tenants List */}
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <span className="text-xl">🏢</span>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Tenant Management</h3>
                  <p className="text-sm text-slate-400">Overview of all tenants and their activity</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateTenant(true)}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Tenant
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-violet-500 border-t-transparent"></div>
              </div>
            ) : tenants.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-700/50 flex items-center justify-center">
                  <span className="text-3xl">🏢</span>
                </div>
                <h4 className="text-lg font-medium text-white mb-2">No tenants yet</h4>
                <p className="text-slate-400 mb-4">Create your first tenant to get started</p>
                <button
                  onClick={() => setShowCreateTenant(true)}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-medium hover:from-violet-600 hover:to-fuchsia-600 transition-all"
                >
                  Create First Tenant
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {tenants.map((tenant) => (
                  <div key={tenant.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-slate-700 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">{tenant.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <h4 className="font-medium text-white">{tenant.name}</h4>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-slate-400">ATI: {tenant.ati_id}</span>
                          <span className="text-xs text-slate-500">•</span>
                          <span className="text-xs text-slate-400">{tenant.user_count} users</span>
                          <span className="text-xs text-slate-500">•</span>
                          <span className="text-xs text-slate-400">{tenant.ati_token_count} tokens</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        tenant.status === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {tenant.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Create Tenant Modal */}
      {showCreateTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="relative w-full max-w-2xl mx-4 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div>
                <h2 className="text-xl font-semibold text-white">Create New Tenant</h2>
                <p className="text-sm text-slate-400 mt-1">Set up a new organization with optional ATI token</p>
              </div>
              <button
                onClick={() => setShowCreateTenant(false)}
                className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="p-6 space-y-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Basic Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Tenant Name</label>
                    <input
                      type="text"
                      value={newTenant.name}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                      placeholder="e.g., Acme Corporation"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">ATI ID</label>
                    <input
                      type="text"
                      value={newTenant.atiId}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, atiId: e.target.value.toUpperCase() }))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors uppercase"
                      placeholder="e.g., ACME"
                      required
                    />
                    <p className="text-xs text-slate-500 mt-1">Unique identifier for ATI tokens and routing</p>
                  </div>
                </div>
              </div>

              {/* Token Configuration */}
              <div className="space-y-4 pt-4 border-t border-slate-700">
                <div className="flex items-center gap-3">
                  <input
                    id="generate_token"
                    type="checkbox"
                    checked={newTenant.generateInitialToken}
                    onChange={(e) => setNewTenant(prev => ({ ...prev, generateInitialToken: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-slate-800"
                  />
                  <label htmlFor="generate_token" className="text-sm font-medium text-white">Generate Initial ATI Token</label>
                </div>

                {newTenant.generateInitialToken && (
                  <div className="ml-7 pl-4 border-l-2 border-violet-500/30 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Expiration Date</label>
                        <input
                          type="datetime-local"
                          value={newTenant.expires_at}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, expires_at: e.target.value }))}
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Max Uses</label>
                        <input
                          type="number"
                          value={newTenant.max_uses}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, max_uses: e.target.value }))}
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                          placeholder="Unlimited"
                          min="1"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Plan Tier</label>
                        <select
                          value={newTenant.plan_tier}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, plan_tier: e.target.value }))}
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                        >
                          <option value="BASIC">Basic</option>
                          <option value="PRO">Pro</option>
                          <option value="ENTERPRISE">Enterprise</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                        <input
                          type="text"
                          value={newTenant.notes}
                          onChange={(e) => setNewTenant(prev => ({ ...prev, notes: e.target.value }))}
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                          placeholder="Optional notes"
                        />
                      </div>
                    </div>

                    {/* Security Warning */}
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <span className="text-xl">⚠️</span>
                      <div>
                        <h4 className="font-medium text-amber-400">Security Notice</h4>
                        <p className="text-sm text-amber-300/80 mt-1">
                          The generated token will only be displayed once. Copy and share it securely.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowCreateTenant(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-medium hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create Tenant
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && createdTokenInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-4 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="text-emerald-400">✅</span>
                Tenant Created
              </h3>
              <button
                onClick={() => { setShowSuccessModal(false); setCreatedTokenInfo(null); }}
                className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-sm text-emerald-300">
                  Tenant "{createdTokenInfo.tenantName}" has been created successfully!
                </p>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="text-amber-400">⚠️</span>
                  <h4 className="font-medium text-amber-400">Initial ATI Token</h4>
                </div>
                <div className="font-mono text-sm bg-slate-900 p-3 rounded-lg text-amber-300 break-all">
                  {createdTokenInfo.token}
                </div>
                <p className="text-xs text-slate-400">
                  <strong>Fingerprint:</strong> <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300">{createdTokenInfo.fingerprint}</code>
                </p>
                <p className="text-sm text-amber-300/80">
                  Copy this token now! It will not be shown again.
                </p>
                <button
                  onClick={() => copyToClipboard(createdTokenInfo.token)}
                  className="w-full px-4 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors flex items-center justify-center gap-2"
                >
                  <span>📋</span>
                  Copy Token to Clipboard
                </button>
              </div>

              <button
                onClick={() => { setShowSuccessModal(false); setCreatedTokenInfo(null); }}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-700 text-white hover:bg-slate-600 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
