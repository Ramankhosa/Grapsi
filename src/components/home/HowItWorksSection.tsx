'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { BrainCircuit, ScanSearch, FileCode2, ArrowRight } from 'lucide-react'

const steps = [
  {
    id: "01",
    title: "Neural Capture",
    description: "Input your raw invention concepts. Our AI deconstructs your idea into semantic vector embeddings, understanding the core technical principles instantly.",
    icon: BrainCircuit
  },
  {
    id: "02",
    title: "Global Intelligence Scan",
    description: "We cross-reference your concept against millions of global patents in real-time. Identifying white space, potential conflicts, and novelty opportunities.",
    icon: ScanSearch
  },
  {
    id: "03",
    title: "Generative Synthesis",
    description: "The system constructs a full patent specification—claims, abstract, and detailed description—using attorney-grade language models tailored to your jurisdiction.",
    icon: FileCode2
  }
]

export default function HowItWorksSection() {
  const containerRef = useRef<HTMLDivElement>(null)
  
  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden" ref={containerRef}>
       <div className="absolute inset-0 z-0 opacity-30">
         <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-ai-blue-500/30 to-transparent transform -translate-y-1/2 hidden md:block" />
       </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-24">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold text-white mb-6"
          >
            The Pipeline
          </motion.h2>
          <p className="text-lg text-ai-graphite-400 max-w-2xl mx-auto">
            From neuron to patent application in three intelligent stages.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 relative">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="relative z-10 flex flex-col items-center text-center"
              >
                {/* Hexagon Background for Icon */}
                <div className="relative w-24 h-24 mb-8 flex items-center justify-center group">
                   <div className="absolute inset-0 bg-ai-blue-900/20 clip-path-hexagon backdrop-blur-sm group-hover:bg-ai-blue-500/20 transition-colors duration-500" 
                        style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} 
                   />
                   <div className="absolute inset-0 border-2 border-ai-blue-500/30 clip-path-hexagon group-hover:border-ai-blue-400 transition-colors duration-500" 
                        style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                   />
                   <step.icon className="w-10 h-10 text-ai-blue-400 group-hover:text-white transition-colors duration-500" />
                   
                   {/* Connector Line (Mobile: Down, Desktop: Right) */}
                   {index < steps.length - 1 && (
                     <div className="absolute top-full left-1/2 w-0.5 h-12 bg-ai-blue-500/30 md:hidden" />
                   )}
                </div>

                <div className="mb-4">
                   <span className="text-xs font-mono text-ai-blue-500/80 tracking-widest uppercase mb-2 block">Phase {step.id}</span>
                   <h3 className="text-xl font-bold text-white">{step.title}</h3>
                </div>
                
                <p className="text-ai-graphite-300 leading-relaxed text-sm">
                  {step.description}
                </p>
              </motion.div>
              
               {/* Desktop Connector Arrow */}
               {index < steps.length - 1 && (
                 <div className="hidden md:flex absolute top-12 -right-4 w-8 text-ai-blue-500/20 justify-center transform translate-x-1/2 z-0">
                   <ArrowRight className="w-8 h-8" />
                 </div>
               )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
