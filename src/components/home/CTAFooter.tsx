'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { motion } from 'framer-motion'
import { Rocket, ArrowRight } from 'lucide-react'

export default function CTAFooter() {
  const { user } = useAuth()

  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden flex items-center justify-center">
      
      {/* Glowing Portal Background */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[800px] h-[800px] bg-gradient-to-br from-ai-blue-600/20 to-purple-600/20 rounded-full blur-[120px] animate-pulse" />
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="relative z-10 max-w-4xl mx-auto px-4 text-center"
      >
        <h2 className="text-4xl md:text-6xl font-bold text-white mb-8 tracking-tight">
          Ready to materialize your intellect?
        </h2>
        
        <p className="text-xl text-ai-blue-200/80 mb-12 max-w-2xl mx-auto font-light">
          The gateway to patent protection is open. Step through.
        </p>

        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
          <Link href={user ? '/patents/draft/new' : '/register'}>
            <button className="group relative inline-flex items-center gap-3 px-10 py-4 bg-white text-ai-graphite-950 font-bold rounded-lg hover:bg-ai-blue-50 transition-all duration-200 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)]">
              <Rocket className="w-5 h-5" />
              Initialize Project
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>

          <button
            type="button"
            onClick={() => window.open('mailto:demo@patentnest.ai?subject=Request Intelligence Demo', '_blank')}
            className="inline-flex items-center gap-3 px-10 py-4 border border-ai-blue-500/30 text-ai-blue-300 font-medium rounded-lg hover:bg-ai-blue-500/10 hover:text-white transition-all duration-200 backdrop-blur-sm"
          >
            Request Access
          </button>
        </div>

        <div className="mt-12 flex justify-center items-center gap-2 text-xs text-ai-graphite-500 font-mono uppercase tracking-widest">
           <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
           Secure Transmission • Encrypted
        </div>
      </motion.div>
    </section>
  )
}
