'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Compass,
  FileText,
  LayoutDashboard,
  Search,
  ShieldCheck,
  UserCircle,
  Users,
  Sparkles
} from 'lucide-react'
import GettingStartedCard from '@/components/dashboards/GettingStartedCard'
import WorkshopAccessBanner from '@/components/dashboards/WorkshopAccessBanner'

interface ProductOption {
  title: string
  description: string
  href: string
  icon: typeof Search
  gradient: string
  glowColor: string
  iconBg: string
  iconColor: string
  borderHover: string
  tag: string
  orbColor: string
}

const productOptions: ProductOption[] = [
  {
    title: 'Fund Finder',
    description: 'Discover funding opportunities with AI-powered search and intelligent matching.',
    href: '/finder',
    icon: Search,
    gradient: 'from-cyan-500 to-teal-500',
    glowColor: 'rgba(6, 182, 212, 0.08)',
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    borderHover: 'hover:border-cyan-200',
    tag: 'Discovery',
    orbColor: 'bg-cyan-200/40'
  },
  {
    title: 'Grant Writer',
    description: 'Build and manage grant applications with structured AI-assisted drafting.',
    href: '/projects',
    icon: FileText,
    gradient: 'from-blue-500 to-indigo-500',
    glowColor: 'rgba(59, 130, 246, 0.08)',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    borderHover: 'hover:border-blue-200',
    tag: 'Writing',
    orbColor: 'bg-blue-200/40'
  },
  {
    title: 'Researcher Profile',
    description: 'Define your profile and eligibility for personalized funding discovery.',
    href: '/profile/researcher',
    icon: UserCircle,
    gradient: 'from-amber-500 to-orange-500',
    glowColor: 'rgba(245, 158, 11, 0.08)',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    borderHover: 'hover:border-amber-200',
    tag: 'Identity',
    orbColor: 'bg-amber-200/40'
  },
  {
    title: 'Research Fit',
    description: 'Manage research areas and key publications for better funding matches.',
    href: '/profile/research-fit',
    icon: Compass,
    gradient: 'from-emerald-500 to-green-500',
    glowColor: 'rgba(16, 185, 129, 0.08)',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    borderHover: 'hover:border-emerald-200',
    tag: 'Focus',
    orbColor: 'bg-emerald-200/40'
  },
  {
    title: 'Grant Reviewer',
    description: 'Run structured reviews, context summaries, and generate final review reports.',
    href: '/reviewer',
    icon: ShieldCheck,
    gradient: 'from-violet-500 to-purple-500',
    glowColor: 'rgba(139, 92, 246, 0.08)',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    borderHover: 'hover:border-violet-200',
    tag: 'Analysis',
    orbColor: 'bg-violet-200/40'
  }
]

const adminOption: ProductOption = {
  title: 'Team & Workspace Admin',
  description: 'Invite members, manage access codes, and oversee workspace usage.',
  href: '/admin',
  icon: Users,
  gradient: 'from-slate-500 to-slate-700',
  glowColor: 'rgba(100, 116, 139, 0.08)',
  iconBg: 'bg-slate-100',
  iconColor: 'text-slate-600',
  borderHover: 'hover:border-slate-300',
  tag: 'Admin',
  orbColor: 'bg-slate-200/40'
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.3 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 260, damping: 24 }
  }
}

function FloatingOrb({ className, delay = 0 }: { className: string; delay?: number }) {
  return (
    <motion.div
      className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
      animate={{
        y: [0, -20, 0],
        x: [0, 10, 0],
        scale: [1, 1.08, 1]
      }}
      transition={{
        duration: 10,
        repeat: Infinity,
        ease: 'easeInOut',
        delay
      }}
    />
  )
}

function ProductCard({
  option,
  index,
  totalCount
}: {
  option: ProductOption
  index: number
  totalCount: number
}) {
  const Icon = option.icon
  // Only stretch the last card across the grid when the count is odd
  const isWide = index === totalCount - 1 && totalCount % 2 === 1

  return (
    <motion.div variants={itemVariants} className={isWide ? 'md:col-span-2 lg:col-span-2' : ''}>
      <Link
        href={option.href}
        className={`
          group relative flex h-full flex-col overflow-hidden rounded-2xl
          border border-slate-200/70 bg-white/80 backdrop-blur-sm
          p-6 shadow-sm
          transition-all duration-500 ease-out
          hover:bg-white hover:shadow-lg hover:-translate-y-1
          ${option.borderHover}
        `}
      >
        <div
          className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), ${option.glowColor}, transparent 40%)`
          }}
        />

        <div className="absolute top-0 left-0 right-0 h-[2px]">
          <div
            className={`h-full w-0 bg-gradient-to-r ${option.gradient} transition-all duration-700 group-hover:w-full opacity-80`}
          />
        </div>

        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${option.iconBg} transition-all duration-300 group-hover:scale-110`}
            >
              <Icon className={`h-5 w-5 ${option.iconColor}`} />
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium tracking-wider text-slate-400 uppercase">
              {option.tag}
            </span>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 transition-all duration-300 group-hover:bg-slate-100">
            <ArrowRight className="h-4 w-4 text-slate-300 transition-all duration-300 group-hover:text-slate-500 group-hover:translate-x-0.5" />
          </div>
        </div>

        <div className="relative z-10 mt-5 flex-1">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900 transition-colors duration-300">
            {option.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400 transition-colors duration-300 group-hover:text-slate-500">
            {option.description}
          </p>
        </div>

        <div className="relative z-10 mt-5 flex items-center gap-2">
          <span
            className={`text-xs font-medium bg-gradient-to-r ${option.gradient} bg-clip-text text-transparent opacity-0 transition-all duration-300 group-hover:opacity-100`}
          >
            Open {option.title}
          </span>
          <div
            className={`h-px flex-1 bg-gradient-to-r ${option.gradient} opacity-0 transition-all duration-500 group-hover:opacity-15`}
          />
        </div>
      </Link>
    </motion.div>
  )
}

export default function UserProductChooser() {
  const { user } = useAuth()
  const { isTenantAdmin } = useRoleAccess()
  const options = isTenantAdmin ? [...productOptions, adminOption] : productOptions
  const [mounted, setMounted] = useState(false)
  const firstName =
    user?.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, (c: string) => c.toUpperCase()) ?? ''

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const cards = document.querySelectorAll<HTMLElement>('.group')
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
        card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const currentHour = new Date().getHours()
  const greeting =
    currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50/80">
      <FloatingOrb className="h-[500px] w-[500px] bg-cyan-100/50 -top-48 -left-48" delay={0} />
      <FloatingOrb className="h-[400px] w-[400px] bg-violet-100/40 top-1/3 -right-40" delay={2} />
      <FloatingOrb className="h-[350px] w-[350px] bg-blue-100/40 bottom-20 left-1/4" delay={4} />
      <FloatingOrb className="h-[300px] w-[300px] bg-emerald-100/30 -bottom-24 right-1/3" delay={6} />

      <div className="dash-grid-light absolute inset-0 pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <AnimatePresence>
          {mounted && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="mb-16 text-center"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, duration: 0.5 }}
                  className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-1.5 shadow-sm backdrop-blur-sm"
                >
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  <span className="text-xs font-medium tracking-wide text-slate-500">
                    AI-Powered Research Platform
                  </span>
                </motion.div>

                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                  <span className="text-slate-900">
                    {greeting}
                    {firstName ? ', ' : ''}
                  </span>
                  {firstName && (
                    <span className="dash-gradient-text-light">{firstName}</span>
                  )}
                </h1>

                <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-slate-400">
                  Choose a workspace to get started. Each tool is designed to
                  accelerate a different part of your research workflow.
                </p>
              </motion.div>

              <WorkshopAccessBanner />

              <GettingStartedCard />

              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"
              >
                {options.map((option, i) => (
                  <ProductCard key={option.title} option={option} index={i} totalCount={options.length} />
                ))}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9, duration: 0.5 }}
                className="mt-8"
              >
                <Link
                  href="/dashboard/workspace"
                  className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-slate-200/70 bg-white/60 p-5 backdrop-blur-sm transition-all duration-500 hover:bg-white hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
                      <LayoutDashboard className="h-[18px] w-[18px] text-slate-400" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-slate-600 transition-colors group-hover:text-slate-800">
                        Classic Workspace
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Access the original dashboard with all your existing tools
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition-all duration-300 group-hover:text-slate-500 group-hover:translate-x-1" />
                </Link>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
