'use client'

import { useState, useEffect } from 'react'
import { getCurrentTimeString } from '@/lib/greetings'

interface FooterStripProps {
  careModeEnabled?: boolean
  onCareModeToggle?: (enabled: boolean) => void
}

export default function FooterStrip({ careModeEnabled = true, onCareModeToggle }: FooterStripProps) {
  const [currentTime, setCurrentTime] = useState(getCurrentTimeString())
  const [kishoStatus, setKishoStatus] = useState('active')

  useEffect(() => {
    // Update time every minute
    const timer = setInterval(() => {
      setCurrentTime(getCurrentTimeString())
    }, 60000)

    // Simulate Kisho status changes
    const statusTimer = setInterval(() => {
      const statuses = ['active', 'thinking', 'processing', 'ready']
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]
      setKishoStatus(randomStatus)
    }, 10000)

    return () => {
      clearInterval(timer)
      clearInterval(statusTimer)
    }
  }, [])

  const getKishoStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-600'
      case 'thinking': return 'text-blue-600'
      case 'processing': return 'text-amber-600'
      case 'ready': return 'text-purple-600'
      default: return 'text-gray-600'
    }
  }

  const getKishoStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Active'
      case 'thinking': return 'Thinking'
      case 'processing': return 'Processing'
      case 'ready': return 'Ready'
      default: return 'Online'
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-white/20 px-6 py-3 z-40">
      <div className="max-w-7xl mx-auto flex items-center justify-between text-sm">
        {/* Left side - Status indicators */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${careModeEnabled ? 'bg-green-500' : 'bg-gray-400'} animate-pulse`}></div>
            <span className={`font-medium ${careModeEnabled ? 'text-green-700' : 'text-gray-600'}`}>
              Care Mode {careModeEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="text-gray-400">·</div>

          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <span className="text-gray-700">
              Local time {currentTime}
            </span>
          </div>

          <div className="text-gray-400">·</div>

          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full animate-pulse ${
              kishoStatus === 'active' ? 'bg-green-500' :
              kishoStatus === 'thinking' ? 'bg-blue-500' :
              kishoStatus === 'processing' ? 'bg-amber-500' : 'bg-purple-500'
            }`}></div>
            <span className={`${getKishoStatusColor(kishoStatus)} font-medium`}>
              Kisho {getKishoStatusText(kishoStatus)}
            </span>
          </div>
        </div>

        {/* Right side - Care Mode Toggle */}
        <div className="flex items-center space-x-3">
          <span className="text-xs text-gray-500">Care Mode</span>
          <button
            onClick={() => onCareModeToggle?.(!careModeEnabled)}
            className={`
              relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200
              ${careModeEnabled ? 'bg-green-500' : 'bg-gray-300'}
            `}
          >
            <span
              className={`
                inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 shadow
                ${careModeEnabled ? 'translate-x-6' : 'translate-x-1'}
              `}
            />
          </button>
        </div>
      </div>

      {/* Subtle ambient light effect */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent"></div>
    </div>
  )
}
