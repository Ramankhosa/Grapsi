'use client'

import { motion } from 'framer-motion'
import { useState, useEffect } from 'react'

const messages = [
  "Establishing secure handshake...",
  "Verifying biometric signature...",
  "Decrypting neural patterns...",
  "Accessing PatentNest core...",
  "Identity confirmed."
]

export default function AuthLoader() {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => (prev < messages.length - 1 ? prev + 1 : prev))
    }, 800)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ai-graphite-950/90 backdrop-blur-md">
      <div className="relative flex flex-col items-center">
        
        {/* Rotating Rings */}
        <div className="relative w-32 h-32 mb-8">
          <motion.div
            className="absolute inset-0 border-t-4 border-ai-blue-500 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute inset-2 border-r-4 border-purple-500 rounded-full"
            animate={{ rotate: -360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute inset-4 border-b-4 border-emerald-500 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          
          {/* Center Core */}
          <motion.div 
            className="absolute inset-0 m-auto w-4 h-4 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)]"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>

        {/* Text Status */}
        <div className="h-8 flex items-center justify-center overflow-hidden">
            <motion.p
                key={messageIndex}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                className="text-ai-blue-300 font-mono text-sm tracking-widest uppercase"
            >
                {messages[messageIndex]}
            </motion.p>
        </div>

        {/* Progress Bar */}
        <div className="mt-6 w-64 h-1 bg-ai-graphite-800 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-gradient-to-r from-ai-blue-600 to-purple-600"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 3.5, ease: "easeInOut" }}
          />
        </div>

      </div>
    </div>
  )
}

