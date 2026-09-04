'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookMarked,
  Bot,
  Compass,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronsLeft,
  CircleDollarSign,
  Clock,
  Coins,
  Copy,
  FileText,
  Files,
  Gauge,
  Home,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  Mail,
  Network,
  PenLine,
  Plus,
  Puzzle,
  Radar,
  Rss,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  UserCog,
  Users,
  X
} from 'lucide-react'

type LucideIcon = typeof Users

interface TenantAdmin {
  id: string
  email: string
  name: string | null
  roles: string[]
  status: string
  is_owner: boolean
}

interface Tenant {
  id: string
  name: string
  ati_id: string
  status: string
  user_count: number
  ati_token_count: number
  created_at: string
  admins?: TenantAdmin[]
}

interface TenantUser {
  id: string
  email: string
  name: string | null
  roles: string[]
  status: string
  is_admin: boolean
  is_owner: boolean
  created_at: string
}

/** What happens to the sitting owner when the seat moves. */
type DemotionChoice = 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' | 'KEEP'

const DEMOTION_CHOICES: Array<{ value: DemotionChoice; label: string }> = [
  { value: 'ADMIN', label: 'Keep as Admin' },
  { value: 'MANAGER', label: 'Move to Manager' },
  { value: 'ANALYST', label: 'Move to Analyst' },
  { value: 'VIEWER', label: 'Move to Viewer' },
  { value: 'KEEP', label: 'Leave unchanged (two owners)' }
]

interface NavItem {
  label: string
  icon: LucideIcon
  href?: string
  action?: () => void
  badge?: string
}

interface NavGroup {
  key: string
  title: string
  icon: LucideIcon
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

/* ── One cell of a readout strip ──────────────────────────────────────────── */
function Metric({
  icon: Icon,
  label,
  value,
  caption,
  loading
}: {
  icon: LucideIcon
  label: string
  value: string | number
  caption: string
  loading?: boolean
}) {
  return (
    // Negative offsets collapse each cell's border into its neighbour's, so the
    // strip reads as one ruled grid rather than a row of floating boxes.
    <div className="-ml-px -mt-px flex min-w-0 flex-col gap-3 border-l border-t border-nickel-200 p-5">
      <div className="flex items-center gap-2.5">
        <span className="nk-tile h-8 w-8">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="nk-eyebrow truncate">{label}</span>
      </div>
      {loading ? (
        <span className="h-7 w-20 animate-pulse rounded bg-nickel-100" aria-hidden />
      ) : (
        <span className="nk-readout">{value}</span>
      )}
      <span className="text-[12.5px] text-nickel-500">{caption}</span>
    </div>
  )
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
    token: string | null
    fingerprint: string | null
    tenantName: string
    adminInvite: { email: string; ok: boolean; error?: string } | null
  } | null>(null)
  const [newTenant, setNewTenant] = useState({
    name: '',
    atiId: '',
    adminEmail: '',
    generateInitialToken: true,
    expires_at: '',
    max_uses: '',
    plan_tier: 'BASIC',
    notes: 'Initial tenant onboarding token'
  })
  const [isCreating, setIsCreating] = useState(false)

  // ── Change administrator ────────────────────────────────────────────────
  const [adminTenant, setAdminTenant] = useState<Tenant | null>(null)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[] | null>(null)
  const [isLoadingTenantUsers, setIsLoadingTenantUsers] = useState(false)
  const [selectedAdminId, setSelectedAdminId] = useState('')
  const [demotionChoice, setDemotionChoice] = useState<DemotionChoice>('ADMIN')
  const [isChangingAdmin, setIsChangingAdmin] = useState(false)
  const [adminChangeError, setAdminChangeError] = useState<string | null>(null)
  const [adminChangeNotice, setAdminChangeNotice] = useState<string | null>(null)

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
    setIsLoadingPapers(false)
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
        generateInitialToken: newTenant.generateInitialToken
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
        // Email the named administrator their own single-use signup link. They
        // become the tenant's first user, so signup promotes them to OWNER and
        // they invite their members from the admin dashboard.
        const adminEmail = newTenant.adminEmail.trim()
        let adminInvite: { email: string; ok: boolean; error?: string } | null = null

        if (adminEmail) {
          try {
            const inviteRes = await fetch('/api/v1/platform/tenant-admins', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
              },
              body: JSON.stringify({ tenant_id: data.id, email: adminEmail })
            })
            const inviteData = await inviteRes.json()
            adminInvite = inviteRes.ok
              ? { email: adminEmail, ok: true }
              : { email: adminEmail, ok: false, error: inviteData.message || 'Failed to send invite' }
          } catch (err) {
            console.error('Failed to invite tenant admin:', err)
            adminInvite = { email: adminEmail, ok: false, error: 'Network error while sending the invite' }
          }
        }

        setShowCreateTenant(false)
        setNewTenant({
          name: '',
          atiId: '',
          adminEmail: '',
          generateInitialToken: true,
          expires_at: '',
          max_uses: '',
          plan_tier: 'BASIC',
          notes: 'Initial tenant onboarding token'
        })
        fetchTenants()

        if (data.initial_token || adminInvite) {
          setCreatedTokenInfo({
            token: data.initial_token?.token_display_once ?? null,
            fingerprint: data.initial_token?.fingerprint ?? null,
            tenantName: data.name,
            adminInvite
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

  const openChangeAdmin = async (tenant: Tenant) => {
    setAdminTenant(tenant)
    setTenantUsers(null)
    setSelectedAdminId('')
    setAdminChangeError(null)
    setAdminChangeNotice(null)
    // Defaulting to "keep as Admin" makes the common case — a handover where
    // the outgoing owner stays on the team — a single click.
    setDemotionChoice('ADMIN')
    setIsLoadingTenantUsers(true)

    try {
      const response = await fetch(`/api/v1/platform/tenants/${tenant.id}/users`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      const data = await response.json()

      if (response.ok) {
        setTenantUsers(data.users)
      } else {
        setTenantUsers([])
        setAdminChangeError(data.message || 'Failed to load this tenant’s users')
      }
    } catch (error) {
      console.error('Failed to fetch tenant users:', error)
      setTenantUsers([])
      setAdminChangeError('Network error while loading users')
    } finally {
      setIsLoadingTenantUsers(false)
    }
  }

  const closeChangeAdmin = () => {
    setAdminTenant(null)
    setTenantUsers(null)
    setSelectedAdminId('')
    setAdminChangeError(null)
    setAdminChangeNotice(null)
  }

  const handleChangeAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adminTenant || !selectedAdminId) return

    setIsChangingAdmin(true)
    setAdminChangeError(null)
    setAdminChangeNotice(null)

    try {
      const response = await fetch('/api/v1/platform/tenant-admins', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          tenant_id: adminTenant.id,
          user_id: selectedAdminId,
          role: 'OWNER',
          demote_current_to: demotionChoice === 'KEEP' ? null : demotionChoice
        })
      })

      const data = await response.json()

      if (!response.ok) {
        setAdminChangeError(data.message || 'Failed to change the administrator')
        return
      }

      const promotedLabel = data.promoted?.name || data.promoted?.email
      const demotedCount = data.demoted?.length ?? 0
      setAdminChangeNotice(
        demotedCount > 0
          ? `${promotedLabel} is now the owner of ${adminTenant.name}. The previous owner moved to ${demotionChoice.toLowerCase()}.`
          : `${promotedLabel} is now the owner of ${adminTenant.name}.`
      )
      // Refresh both the row behind the dialog and the dialog itself, so a
      // second transfer in the same sitting starts from the real current state.
      fetchTenants()
      const refreshed = await fetch(`/api/v1/platform/tenants/${adminTenant.id}/users`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (refreshed.ok) {
        const refreshedData = await refreshed.json()
        const users: TenantUser[] = refreshedData.users
        setTenantUsers(users)
        setAdminTenant(prev =>
          prev
            ? {
                ...prev,
                admins: users
                  .filter(u => u.is_admin)
                  .sort((a, b) => Number(b.is_owner) - Number(a.is_owner))
                  .map(u => ({
                    id: u.id,
                    email: u.email,
                    name: u.name,
                    roles: u.roles,
                    status: u.status,
                    is_owner: u.is_owner
                  }))
              }
            : prev
        )
      }
      setSelectedAdminId('')
    } catch (error) {
      console.error('Failed to change tenant admin:', error)
      setAdminChangeError('Network error while changing the administrator')
    } finally {
      setIsChangingAdmin(false)
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
      key: 'analytics',
      title: 'Analytics & Monitoring',
      icon: BarChart3,
      items: [
        { label: 'Platform Analytics', icon: TrendingUp, href: '/super-admin/analytics' },
        { label: 'User Service Usage', icon: Users, href: '/super-admin/user-service-usage' },
        { label: 'Quota Controller', icon: Gauge, href: '/super-admin/quota-controller' },
        { label: 'Jobs & Schedules', icon: Clock, href: '/super-admin/jobs', badge: 'NEW' },
        { label: 'Report Archive', icon: FileText, href: '/super-admin/reports', badge: 'NEW' }
      ]
    },
    {
      key: 'ai',
      title: 'AI & LLM Settings',
      icon: Bot,
      items: [
        { label: 'LLM Model Control', icon: BrainCircuit, href: '/super-admin/llm-config', badge: 'NEW' },
        { label: 'Model Costs', icon: Coins, href: '/super-admin/model-costs' }
      ]
    },
    {
      key: 'paper',
      title: 'Paper Writing',
      icon: FileText,
      items: [
        { label: 'Section Prompts', icon: PenLine, href: '/super-admin/paper-prompts', badge: 'NEW' },
        { label: 'Paper Types', icon: Files, href: '/admin/paper-types' },
        { label: 'Citation Styles', icon: BookMarked, href: '/admin/citation-styles' },
        { label: 'Publication Venues', icon: Landmark, href: '/admin/publication-venues' }
      ]
    },
    {
      key: 'access',
      title: 'Access Management',
      icon: ShieldCheck,
      items: [
        { label: 'Users & Roles', icon: Users, href: '/super-admin/users', badge: 'NEW' },
        { label: 'Plans & Feature Access', icon: Puzzle, href: '/super-admin/plans', badge: 'NEW' },
        { label: 'Team Roles', icon: UserCog, href: '/super-admin/team-roles', badge: 'NEW' },
        { label: 'Funding Control', icon: CircleDollarSign, href: '/super-admin/funding', badge: 'NEW' },
        { label: 'Source Watch', icon: Rss, href: '/funding/monitor', badge: 'NEW' },
        { label: 'Project Intelligence', icon: Radar, href: '/super-admin/project-intelligence/crawlers', badge: 'NEW' },
        { label: 'Research Areas', icon: Network, href: '/super-admin/research-areas', badge: 'NEW' },
        { label: 'Researcher Matching', icon: SearchCheck, href: '/super-admin/researcher-matching', badge: 'NEW' },
        { label: 'Trial Campaigns', icon: Mail, href: '/super-admin/trial-campaigns', badge: 'NEW' },
        { label: 'ATI Token Management', icon: Ticket, href: '/ati-management' },
        { label: 'Service Control', icon: SlidersHorizontal, href: '/super-admin/service-control' }
      ]
    }
    // Patent-specific settings hidden - use direct URLs if needed:
    // /super-admin/jurisdiction-config, /super-admin/countries,
    // /super-admin/section-prompts, /super-admin/jurisdiction-styles,
    // /super-admin/superset-sections
  ]

  const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length

  return (
    <div className="nk-ground">
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <aside
        className={`nk-rail fixed inset-y-0 left-0 z-50 flex flex-col border-r border-nickel-800 transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-nickel-800 px-3">
          {!sidebarCollapsed && (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="nk-tile nk-tile-live h-8 w-8 text-[12px] font-semibold">SA</span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">Platform Console</div>
                <div className="nk-eyebrow text-nickel-400">Super Admin</div>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nickel-400 transition
                       hover:bg-nickel-800 hover:text-white
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-cobalt-500"
          >
            <ChevronsLeft
              className={`h-4 w-4 transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-3">
          <button
            onClick={() => setShowCreateTenant(true)}
            className={`nk-btn-primary w-full ${sidebarCollapsed ? 'px-0' : ''}`}
            title={sidebarCollapsed ? 'Create tenant' : undefined}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {!sidebarCollapsed && <span>Create tenant</span>}
          </button>

          <div className="space-y-1 pt-3">
            {navGroups.map(group => {
              const GroupIcon = group.icon
              const expanded = expandedGroups[group.key]

              if (sidebarCollapsed) {
                return (
                  <div key={group.key} className="space-y-1 border-t border-nickel-800 pt-1 first:border-0">
                    {group.items.map(item => {
                      const ItemIcon = item.icon
                      return (
                        <button
                          key={item.label}
                          onClick={() => (item.href ? router.push(item.href) : item.action?.())}
                          title={item.label}
                          className="flex w-full items-center justify-center rounded-md p-2.5 text-nickel-400 transition
                                     hover:bg-nickel-800 hover:text-white
                                     focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                                     focus-visible:outline-cobalt-500"
                        >
                          <ItemIcon className="h-[18px] w-[18px]" aria-hidden />
                        </button>
                      )
                    })}
                  </div>
                )
              }

              return (
                <div key={group.key} className="pb-1">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-nickel-400 transition
                               hover:text-nickel-300
                               focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                               focus-visible:outline-cobalt-500"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <GroupIcon className="h-[15px] w-[15px] shrink-0" aria-hidden />
                      <span className="nk-eyebrow truncate">{group.title}</span>
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
                      aria-hidden
                    />
                  </button>

                  {expanded && (
                    <div className="mt-0.5 space-y-0.5 border-l border-nickel-800 pl-2.5">
                      {group.items.map(item => {
                        const ItemIcon = item.icon
                        return (
                          <button
                            key={item.label}
                            onClick={() => (item.href ? router.push(item.href) : item.action?.())}
                            className="group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left
                                       text-nickel-300 transition hover:bg-nickel-800 hover:text-white
                                       focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                                       focus-visible:outline-cobalt-500"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <ItemIcon
                                className="h-[15px] w-[15px] shrink-0 text-nickel-400 transition group-hover:text-cobalt-400"
                                aria-hidden
                              />
                              <span className="truncate text-[13px]">{item.label}</span>
                            </span>
                            {item.badge && (
                              <span className="shrink-0 rounded border border-cobalt-700 bg-cobalt-900/60 px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em] text-cobalt-300">
                                {item.badge}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-nickel-800 p-2" ref={userMenuRef}>
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-nickel-800
                          focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
                          focus-visible:outline-cobalt-500 ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <span className="nk-tile nk-tile-dark h-8 w-8 text-[12px] font-semibold text-white">
                {user?.email?.charAt(0)?.toUpperCase() || 'S'}
              </span>
              {!sidebarCollapsed && (
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[12.5px] font-medium text-nickel-200">
                    {user?.email}
                  </span>
                  <span className="nk-eyebrow text-nickel-400">Platform admin</span>
                </span>
              )}
            </button>

            {showUserMenu && (
              <div
                className={`absolute bottom-full mb-2 min-w-[210px] overflow-hidden rounded-lg border border-nickel-200
                            bg-white shadow-nk-sheet ${sidebarCollapsed ? 'left-full ml-2' : 'left-0 right-0'}`}
              >
                <div className="border-b border-nickel-200 bg-nickel-50 px-4 py-3">
                  <div className="truncate text-[13px] font-medium text-nickel-900">{user?.email}</div>
                  <div className="nk-eyebrow mt-1">Platform administrator</div>
                </div>
                <div className="p-1">
                  <button
                    onClick={() => { router.push('/dashboard'); setShowUserMenu(false) }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-nickel-700 transition hover:bg-nickel-100"
                  >
                    <Home className="h-4 w-4 text-nickel-400" aria-hidden />
                    Main dashboard
                  </button>
                  <button
                    onClick={() => { router.push('/guide'); setShowUserMenu(false) }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-nickel-700 transition hover:bg-nickel-100"
                  >
                    <Compass className="h-4 w-4 text-nickel-400" aria-hidden />
                    Where everything is
                  </button>
                  <button
                    onClick={() => { logout(); setShowUserMenu(false) }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-red-700 transition hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Workspace ────────────────────────────────────────────────────── */}
      <main className={`transition-[margin] duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <header className="sticky top-0 z-40 border-b border-nickel-200 bg-nickel-25/85 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
            <div className="min-w-0">
              <p className="nk-eyebrow">Platform</p>
              <h1 className="mt-1 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-nickel-900">
                Overview
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push('/super-admin/project-intelligence/crawlers')}
                className="nk-btn-secondary nk-btn-sm"
              >
                <Radar className="h-4 w-4 text-nickel-400" aria-hidden />
                Project Intelligence
              </button>
              <button onClick={checkExpiryNotifications} className="nk-btn-secondary nk-btn-sm">
                <Bell className="h-4 w-4 text-nickel-400" aria-hidden />
                Check notifications
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-6">
          {/* Readouts */}
          <section className="nk-panel grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              icon={Building2}
              label="Total tenants"
              value={tenants.length}
              caption="Organizations registered"
              loading={isLoading}
            />
            <Metric
              icon={Users}
              label="Total users"
              value={totalUsers}
              caption="Across every tenant"
              loading={isLoading}
            />
            <Metric
              icon={KeyRound}
              label="ATI tokens"
              value={totalTokens}
              caption="Access tokens issued"
              loading={isLoading}
            />
            <Metric
              icon={ShieldCheck}
              label="Active tenants"
              value={activeTenants}
              caption={
                tenants.length ? `${Math.round((activeTenants / tenants.length) * 100)}% of the estate` : 'Currently active'
              }
              loading={isLoading}
            />
          </section>

          {/* Paper analytics readouts (when feature enabled) */}
          {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
            <section className="nk-panel grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                icon={FileText}
                label="Total papers"
                value={paperAnalytics?.totalPapers || 0}
                caption="Across all tenants"
                loading={isLoadingPapers}
              />
              <Metric
                icon={SearchCheck}
                label="Literature searches"
                value={paperAnalytics?.literatureSearchUsage?.totalSearches || 0}
                caption="Academic database queries"
                loading={isLoadingPapers}
              />
              <Metric
                icon={BookMarked}
                label="Citation styles"
                value={paperAnalytics?.citationStylesUsage?.length || 0}
                caption="Styles in use"
                loading={isLoadingPapers}
              />
              <Metric
                icon={TrendingUp}
                label="Avg citations / paper"
                value={
                  paperAnalytics?.averageCitationsByType?.length
                    ? (
                        paperAnalytics.averageCitationsByType.reduce((sum, item) => sum + item.averageCitations, 0) /
                        paperAnalytics.averageCitationsByType.length
                      ).toFixed(1)
                    : '0.0'
                }
                caption="Platform average"
                loading={isLoadingPapers}
              />
            </section>
          )}

          {/* Expiring tokens */}
          {notificationStatus && (
            <section className="nk-panel overflow-hidden">
              <div className="nk-panel-head">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="nk-tile h-9 w-9 border-amber-200 text-amber-600">
                    <Clock className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="nk-title text-[14px]">Expiring tokens</h2>
                    <p className="nk-sub text-[12.5px]">
                      {notificationStatus.expiringTokensCount} token
                      {notificationStatus.expiringTokensCount !== 1 ? 's' : ''} expiring within 7 days
                    </p>
                  </div>
                </div>
                <button
                  onClick={triggerExpiryNotifications}
                  disabled={isCheckingNotifications}
                  className="nk-btn-primary nk-btn-sm"
                >
                  {isCheckingNotifications && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {isCheckingNotifications ? 'Sending…' : 'Send notifications'}
                </button>
              </div>

              {notificationStatus.tokens.length > 0 && (
                <ul className="divide-y divide-nickel-100">
                  {notificationStatus.tokens.slice(0, 5).map((token: any) => (
                    <li key={token.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            token.daysUntilExpiry <= 3
                              ? 'bg-red-500'
                              : token.daysUntilExpiry <= 7
                              ? 'bg-amber-500'
                              : 'bg-nickel-300'
                          }`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="nk-mono truncate text-nickel-900">{token.fingerprint}</div>
                          <div className="truncate text-[12.5px] text-nickel-500">
                            {token.tenantName} · expires in {token.daysUntilExpiry} days
                          </div>
                        </div>
                      </div>
                      <span className="nk-mono shrink-0 text-nickel-500">
                        {new Date(token.expiresAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Paper analytics detail (when feature enabled) */}
          {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && paperAnalytics && (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="nk-panel overflow-hidden">
                  <div className="nk-panel-head">
                    <div>
                      <h2 className="nk-title text-[14px]">Paper types</h2>
                      <p className="nk-sub text-[12.5px]">Most used across the platform</p>
                    </div>
                  </div>
                  <div className="p-5">
                    {paperAnalytics.paperTypesPopularity?.length ? (
                      <ul className="space-y-2.5">
                        {paperAnalytics.paperTypesPopularity.slice(0, 5).map((type, index) => (
                          <li key={type.type} className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="nk-mono w-4 shrink-0 text-nickel-500">{index + 1}</span>
                              <span className="truncate text-[13px] text-nickel-700">{type.type}</span>
                            </span>
                            <span className="nk-readout-sm shrink-0 text-[14px]">{type.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-nickel-500">No data available</p>
                    )}
                  </div>
                </section>

                <section className="nk-panel overflow-hidden">
                  <div className="nk-panel-head">
                    <div>
                      <h2 className="nk-title text-[14px]">Citation styles</h2>
                      <p className="nk-sub text-[12.5px]">Formatting preferences in use</p>
                    </div>
                  </div>
                  <div className="p-5">
                    {paperAnalytics.citationStylesUsage?.length ? (
                      <ul className="space-y-2.5">
                        {paperAnalytics.citationStylesUsage.slice(0, 5).map((style, index) => (
                          <li key={style.style} className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="nk-mono w-4 shrink-0 text-nickel-500">{index + 1}</span>
                              <span className="truncate text-[13px] text-nickel-700">{style.style}</span>
                            </span>
                            <span className="nk-readout-sm shrink-0 text-[14px]">{style.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-nickel-500">No data available</p>
                    )}
                  </div>
                </section>
              </div>

              <section className="nk-panel overflow-hidden">
                <div className="nk-panel-head">
                  <div>
                    <h2 className="nk-title text-[14px]">Literature search API usage</h2>
                    <p className="nk-sub text-[12.5px]">Academic database consumption</p>
                  </div>
                </div>
                {paperAnalytics.literatureSearchUsage?.apiUsage &&
                Object.keys(paperAnalytics.literatureSearchUsage.apiUsage).length ? (
                  <div className="grid grid-cols-2 md:grid-cols-4">
                    {Object.entries(paperAnalytics.literatureSearchUsage.apiUsage).map(([api, count]) => (
                      <div
                        key={api}
                        className="-ml-px -mt-px flex flex-col gap-2 border-l border-t border-nickel-200 p-5"
                      >
                        <span className="nk-eyebrow capitalize">{api.replace('_', ' ')}</span>
                        <span className="nk-readout">{count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-8 text-center text-[13px] text-nickel-500">
                    No API usage data available
                  </p>
                )}
              </section>
            </>
          )}

          {/* Tenants */}
          <section className="nk-panel overflow-hidden">
            <div className="nk-panel-head">
              <div className="flex min-w-0 items-center gap-3">
                <span className="nk-tile h-9 w-9">
                  <Building2 className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="nk-title text-[14px]">Tenant management</h2>
                  <p className="nk-sub text-[12.5px]">Every tenant on the platform and its activity</p>
                </div>
              </div>
              <button onClick={() => setShowCreateTenant(true)} className="nk-btn-primary nk-btn-sm">
                <Plus className="h-4 w-4" aria-hidden />
                Add tenant
              </button>
            </div>

            {isLoading ? (
              // Skeletons match the row layout so nothing shifts when data lands.
              <ul className="divide-y divide-nickel-100" aria-label="Loading tenants">
                {[0, 1, 2].map(i => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <span className="h-10 w-10 shrink-0 animate-pulse rounded-[10px] bg-nickel-100" />
                    <span className="flex-1 space-y-2">
                      <span className="block h-3.5 w-40 animate-pulse rounded bg-nickel-100" />
                      <span className="block h-3 w-56 animate-pulse rounded bg-nickel-100" />
                    </span>
                    <span className="h-5 w-16 shrink-0 animate-pulse rounded bg-nickel-100" />
                  </li>
                ))}
              </ul>
            ) : tenants.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <span className="nk-tile mx-auto h-12 w-12">
                  <Building2 className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 nk-title text-[14px]">No tenants yet</h3>
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-nickel-500">
                  A tenant is an organization with its own users, ATI tokens, and plan. Create the
                  first one to start onboarding.
                </p>
                <button onClick={() => setShowCreateTenant(true)} className="nk-btn-primary mt-5">
                  <Plus className="h-4 w-4" aria-hidden />
                  Create first tenant
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-nickel-100">
                {tenants.map(tenant => (
                  <li
                    key={tenant.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-nickel-50"
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span className="nk-tile h-10 w-10 text-[14px] font-semibold text-nickel-700">
                        {tenant.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-[13.5px] font-medium text-nickel-900">{tenant.name}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-nickel-500">
                          <span className="nk-mono text-nickel-600">{tenant.ati_id}</span>
                          <span className="text-nickel-300" aria-hidden>·</span>
                          <span>
                            <span className="nk-mono text-nickel-700">{tenant.user_count}</span> users
                          </span>
                          <span className="text-nickel-300" aria-hidden>·</span>
                          <span>
                            <span className="nk-mono text-nickel-700">{tenant.ati_token_count}</span> tokens
                          </span>
                          <span className="text-nickel-300" aria-hidden>·</span>
                          {/* The owner is who to contact about this tenant; naming
                              them here saves opening the dialog just to look. */}
                          <span className="truncate">
                            {tenant.admins && tenant.admins.length > 0 ? (
                              <>
                                <span className="text-nickel-700">
                                  {tenant.admins[0].name || tenant.admins[0].email}
                                </span>
                                {tenant.admins.length > 1 && (
                                  <span> +{tenant.admins.length - 1}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-amber-700">No administrator</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className={`nk-badge ${tenant.status === 'ACTIVE' ? 'nk-badge-ok' : 'nk-badge-danger'}`}
                      >
                        {tenant.status}
                      </span>
                      <span className="nk-mono text-nickel-500">
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => openChangeAdmin(tenant)}
                        className="nk-btn-secondary nk-btn-sm"
                      >
                        <UserCog className="h-4 w-4 text-nickel-400" aria-hidden />
                        Change admin
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* ── Create tenant ────────────────────────────────────────────────── */}
      {showCreateTenant && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create new tenant"
          className="fixed inset-0 z-50 overflow-y-auto bg-nickel-900/45 px-4 py-8 backdrop-blur-sm"
        >
          <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-nickel-200 bg-white shadow-nk-sheet">
            <div className="nk-panel-head flex-nowrap">
              <div className="min-w-0">
                <h2 className="nk-title">Create new tenant</h2>
                <p className="nk-sub mt-0.5">Set up an organization and its first ATI token</p>
              </div>
              <button
                onClick={() => setShowCreateTenant(false)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nickel-500 transition hover:bg-nickel-100 hover:text-nickel-700"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-6 p-5">
              <fieldset className="space-y-3.5">
                <legend className="nk-eyebrow mb-3">Basic information</legend>
                <div>
                  <label htmlFor="tenant_name" className="nk-label mb-1.5">Tenant name</label>
                  <input
                    id="tenant_name"
                    type="text"
                    value={newTenant.name}
                    onChange={e => setNewTenant(prev => ({ ...prev, name: e.target.value }))}
                    className="nk-input"
                    placeholder="e.g. Acme Corporation"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="tenant_ati" className="nk-label mb-1.5">ATI ID</label>
                  <input
                    id="tenant_ati"
                    type="text"
                    value={newTenant.atiId}
                    onChange={e => setNewTenant(prev => ({ ...prev, atiId: e.target.value.toUpperCase() }))}
                    className="nk-input font-mono uppercase"
                    placeholder="e.g. ACME"
                    required
                  />
                  <p className="mt-1.5 text-[12px] text-nickel-500">
                    Unique identifier used for ATI tokens and routing
                  </p>
                </div>
                <div>
                  <label htmlFor="tenant_admin_email" className="nk-label mb-1.5">
                    Administrator email
                  </label>
                  <input
                    id="tenant_admin_email"
                    type="email"
                    value={newTenant.adminEmail}
                    onChange={e => setNewTenant(prev => ({ ...prev, adminEmail: e.target.value }))}
                    className="nk-input"
                    placeholder="admin@acme.edu"
                  />
                  <p className="mt-1.5 text-[12px] text-nickel-500">
                    We email this person a personal signup link. As the first user they
                    become the workspace <span className="font-medium text-nickel-700">Owner</span>,
                    and invite their own members from there. Leave blank to hand over the
                    token below manually instead.
                  </p>
                </div>
              </fieldset>

              <fieldset className="nk-rule space-y-4 pt-5">
                <div className="flex items-center gap-2.5">
                  <input
                    id="generate_token"
                    type="checkbox"
                    checked={newTenant.generateInitialToken}
                    onChange={e => setNewTenant(prev => ({ ...prev, generateInitialToken: e.target.checked }))}
                    className="h-4 w-4 rounded border-nickel-300 text-cobalt-600 focus:ring-cobalt-500"
                  />
                  <label htmlFor="generate_token" className="text-[13.5px] font-medium text-nickel-800">
                    Generate an initial ATI token
                  </label>
                </div>

                {newTenant.generateInitialToken && (
                  <div className="ml-1.5 space-y-4 border-l-2 border-cobalt-100 pl-4">
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="token_expires" className="nk-label mb-1.5">Expiration date</label>
                        <input
                          id="token_expires"
                          type="datetime-local"
                          value={newTenant.expires_at}
                          onChange={e => setNewTenant(prev => ({ ...prev, expires_at: e.target.value }))}
                          className="nk-input"
                        />
                      </div>
                      <div>
                        <label htmlFor="token_max_uses" className="nk-label mb-1.5">Max uses</label>
                        <input
                          id="token_max_uses"
                          type="number"
                          value={newTenant.max_uses}
                          onChange={e => setNewTenant(prev => ({ ...prev, max_uses: e.target.value }))}
                          className="nk-input"
                          placeholder="Unlimited"
                          min="1"
                        />
                      </div>
                      <div>
                        <label htmlFor="token_tier" className="nk-label mb-1.5">Plan tier</label>
                        <select
                          id="token_tier"
                          value={newTenant.plan_tier}
                          onChange={e => setNewTenant(prev => ({ ...prev, plan_tier: e.target.value }))}
                          className="nk-select"
                        >
                          <option value="BASIC">Basic</option>
                          <option value="PRO">Pro</option>
                          <option value="ENTERPRISE">Enterprise</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="token_notes" className="nk-label mb-1.5">Notes</label>
                        <input
                          id="token_notes"
                          type="text"
                          value={newTenant.notes}
                          onChange={e => setNewTenant(prev => ({ ...prev, notes: e.target.value }))}
                          className="nk-input"
                          placeholder="Optional"
                        />
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
                      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                      <p className="text-[12.5px] leading-5 text-amber-900">
                        <span className="font-semibold">Shown once.</span> The generated token is
                        displayed a single time — copy it and share it securely.
                      </p>
                    </div>
                  </div>
                )}
              </fieldset>

              <div className="nk-rule flex items-center justify-end gap-2.5 pt-5">
                <button type="button" onClick={() => setShowCreateTenant(false)} className="nk-btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isCreating} className="nk-btn-primary">
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" aria-hidden />
                      Create tenant
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Token handoff ────────────────────────────────────────────────── */}
      {showSuccessModal && createdTokenInfo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tenant created"
          className="fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/45 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-nickel-200 bg-white shadow-nk-sheet">
            <div className="nk-panel-head flex-nowrap">
              <div className="min-w-0">
                <h2 className="nk-title">Tenant created</h2>
                <p className="nk-sub mt-0.5 truncate">{createdTokenInfo.tenantName}</p>
              </div>
              <button
                onClick={() => { setShowSuccessModal(false); setCreatedTokenInfo(null) }}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nickel-500 transition hover:bg-nickel-100 hover:text-nickel-700"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {createdTokenInfo.adminInvite && (
                <div
                  className={`rounded-lg border p-3.5 ${
                    createdTokenInfo.adminInvite.ok
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-red-200 bg-red-50'
                  }`}
                >
                  {createdTokenInfo.adminInvite.ok ? (
                    <p className="text-[12.5px] leading-5 text-emerald-900">
                      <span className="font-semibold">Administrator invited.</span> A signup
                      link is on its way to{' '}
                      <span className="font-medium">{createdTokenInfo.adminInvite.email}</span>.
                      They become the workspace Owner when they accept, and can invite
                      members themselves. The link expires in 14 days.
                    </p>
                  ) : (
                    <p className="text-[12.5px] leading-5 text-red-900">
                      <span className="font-semibold">Admin invite failed:</span>{' '}
                      {createdTokenInfo.adminInvite.error} — the tenant was still created.
                      Retry from ATI Management, or hand over the token below.
                    </p>
                  )}
                </div>
              )}

              {createdTokenInfo.token && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span className="nk-eyebrow text-amber-800">Copy it now — shown once</span>
                  </div>
                  <p className="mt-3 break-all rounded-md border border-amber-200 bg-white p-3 font-mono text-[12.5px] leading-5 text-nickel-900">
                    {createdTokenInfo.token}
                  </p>
                  <p className="mt-2.5 text-[12px] text-amber-900">
                    Fingerprint{' '}
                    <code className="nk-mono rounded bg-white px-1.5 py-0.5 text-nickel-700">
                      {createdTokenInfo.fingerprint}
                    </code>
                  </p>
                  <button
                    onClick={() => copyToClipboard(createdTokenInfo.token!)}
                    className="nk-btn-secondary mt-3 w-full"
                  >
                    <Copy className="h-4 w-4 text-nickel-400" aria-hidden />
                    Copy token to clipboard
                  </button>
                </div>
              )}

              <button
                onClick={() => { setShowSuccessModal(false); setCreatedTokenInfo(null) }}
                className="nk-btn-primary w-full"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change administrator ─────────────────────────────────────────── */}
      {adminTenant && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Change administrator for ${adminTenant.name}`}
          className="fixed inset-0 z-50 overflow-y-auto bg-nickel-900/45 px-4 py-8 backdrop-blur-sm"
        >
          <div className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-nickel-200 bg-white shadow-nk-sheet">
            <div className="nk-panel-head flex-nowrap">
              <div className="min-w-0">
                <h2 className="nk-title">Change administrator</h2>
                <p className="nk-sub mt-0.5 truncate">{adminTenant.name}</p>
              </div>
              <button
                onClick={closeChangeAdmin}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nickel-500 transition hover:bg-nickel-100 hover:text-nickel-700"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleChangeAdmin} className="space-y-5 p-5">
              <div className="rounded-lg border border-nickel-200 bg-nickel-50 p-3.5">
                <span className="nk-eyebrow">Current administrator</span>
                {adminTenant.admins && adminTenant.admins.length > 0 ? (
                  <ul className="mt-2.5 space-y-1.5">
                    {adminTenant.admins.map(admin => (
                      <li key={admin.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="min-w-0 truncate text-nickel-800">
                          {admin.name ? `${admin.name} · ` : ''}
                          <span className="nk-mono text-nickel-600">{admin.email}</span>
                        </span>
                        <span className="nk-badge shrink-0">{admin.is_owner ? 'OWNER' : 'ADMIN'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12.5px] leading-5 text-nickel-600">
                    Nobody administers this tenant yet.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="new_admin_user" className="nk-label mb-1.5">
                  New administrator
                </label>
                {isLoadingTenantUsers ? (
                  <span className="block h-9 w-full animate-pulse rounded-md bg-nickel-100" aria-hidden />
                ) : (
                  <select
                    id="new_admin_user"
                    value={selectedAdminId}
                    onChange={e => setSelectedAdminId(e.target.value)}
                    className="nk-input"
                    required
                  >
                    <option value="">Select a member of this tenant…</option>
                    {(tenantUsers ?? []).map(u => (
                      <option
                        key={u.id}
                        value={u.id}
                        // Already the owner, so there is nothing to move. Suspended
                        // users are rejected server-side too.
                        disabled={u.is_owner || u.status !== 'ACTIVE'}
                      >
                        {u.name ? `${u.name} — ` : ''}{u.email}
                        {u.is_owner ? ' (current owner)' : u.status !== 'ACTIVE' ? ` (${u.status.toLowerCase()})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-1.5 text-[12px] text-nickel-500">
                  They take over as workspace Owner immediately — no email or acceptance
                  step. To hand the tenant to somebody without an account yet, create it in
                  Users &amp; Roles first, or invite them from ATI Management.
                </p>
              </div>

              <div>
                <label htmlFor="demote_current" className="nk-label mb-1.5">
                  Outgoing owner
                </label>
                <select
                  id="demote_current"
                  value={demotionChoice}
                  onChange={e => setDemotionChoice(e.target.value as DemotionChoice)}
                  className="nk-input"
                  disabled={!adminTenant.admins?.some(a => a.is_owner)}
                >
                  {DEMOTION_CHOICES.map(choice => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-nickel-500">
                  Applies to whoever holds Owner today. Their team memberships and
                  additive grants (Call Admin, Quality Auditor) are kept either way.
                </p>
              </div>

              {adminChangeError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5">
                  <p className="text-[12.5px] leading-5 text-red-900">{adminChangeError}</p>
                </div>
              )}

              {adminChangeNotice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5">
                  <p className="text-[12.5px] leading-5 text-emerald-900">{adminChangeNotice}</p>
                </div>
              )}

              <div className="flex justify-end gap-2.5">
                <button type="button" onClick={closeChangeAdmin} className="nk-btn-secondary">
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isChangingAdmin || !selectedAdminId}
                  className="nk-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChangingAdmin ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Transferring…
                    </>
                  ) : (
                    <>
                      <UserCog className="h-4 w-4" aria-hidden />
                      Make owner
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
