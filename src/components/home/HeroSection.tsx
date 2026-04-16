'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Sparkles, Search, FileText } from 'lucide-react'

export default function HeroSection() {
  const { user } = useAuth()
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const { scrollY } = useScroll()

  // Parallax and opacity effects based on scroll
  const y1 = useTransform(scrollY, [0, 500], [0, 200])
  const opacity = useTransform(scrollY, [0, 300], [1, 0])
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: e.clientX,
        y: e.clientY
      })
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-ai-graphite-950 text-white selection:bg-ai-blue-500/30">
      
      {/* Animated Background Grid (Portal Effect) */}
      <div className="absolute inset-0 z-0 perspective-1000">
        <motion.div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(56, 189, 248, 0.1) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(56, 189, 248, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
            transform: 'perspective(500px) rotateX(60deg) translateY(-100px) translateZ(-200px)',
            transformOrigin: 'top center',
          }}
          animate={{
            backgroundPosition: ['0px 0px', '0px 40px'],
          }}
          transition={{
            repeat: Infinity,
            duration: 20,
            ease: "linear"
          }}
        />
        
        {/* Ambient Glow following mouse */}
        <div 
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(14, 165, 233, 0.15), transparent 40%)`
          }}
        />
      </div>

      {/* Main Content Container */}
      <motion.div 
        className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center"
        style={{ y: y1, opacity }}
      >
        
        {/* Portal Opening Animation */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-ai-blue-500/20 blur-[100px] rounded-full pointer-events-none"
        />

        {/* Badge */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="mb-8"
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-ai-blue-500/30 bg-ai-blue-900/20 backdrop-blur-md text-sm font-medium text-ai-blue-200 shadow-[0_0_15px_rgba(14,165,233,0.3)]">
            <Sparkles className="w-4 h-4 text-ai-blue-400" />
            <span>Intelligence, Redefined</span>
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.8 }}
          className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white via-ai-blue-100 to-ai-blue-200/50 mb-8"
        >
          Paper Nest<span className="text-ai-blue-500">.ai</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.8 }}
          className="text-lg md:text-2xl text-ai-graphite-300 max-w-3xl mx-auto mb-12 leading-relaxed font-light"
        >
          Step into the <span className="text-white font-medium">future of invention</span>. 
          The world's most advanced AI cockpit for patent drafting and novelty analysis.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8 }}
          className="flex flex-col sm:flex-row gap-6 items-center justify-center w-full"
        >
          <Link href={user ? '/patents/draft/new' : '/login'} className="group relative w-full sm:w-auto">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-ai-blue-500 to-cyan-500 rounded-lg blur opacity-30 group-hover:opacity-70 transition duration-200"></div>
            <button className="relative w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-ai-graphite-900 border border-ai-blue-500/50 rounded-lg text-white font-medium hover:bg-ai-graphite-800 transition-all duration-200">
              <FileText className="w-5 h-5" />
              Start Drafting
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>

          <Link href={user ? '/novelty-search' : '/login'} className="w-full sm:w-auto">
             <button className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-white/5 border border-white/10 rounded-lg text-ai-graphite-200 font-medium hover:bg-white/10 hover:text-white backdrop-blur-sm transition-all duration-200">
              <Search className="w-5 h-5" />
              Novelty Search
            </button>
          </Link>
        </motion.div>

        {/* Micro-interaction: Status Indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="mt-16 flex items-center gap-8 text-xs text-ai-graphite-500 uppercase tracking-widest font-mono"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            System Online
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-ai-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
            AI Core Active
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
            Global DB Connected
          </div>
        </motion.div>

      </motion.div>

      {/* Decorative Elements */}
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-ai-graphite-950 to-transparent pointer-events-none" />
    </section>
  )
}
