'use client'

import AnimatedLogo from '@/components/ui/animated-logo'
import Image from 'next/image'

export default function TestGifPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">GIF Test Page</h1>

        <div className="space-y-8">
          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Small Logo</h2>
            <AnimatedLogo size="sm" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Medium Logo (Default)</h2>
            <AnimatedLogo size="md" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Large Logo</h2>
            <AnimatedLogo size="lg" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Extra Large Logo</h2>
            <AnimatedLogo size="xl" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">2-Second Auto-Play + Pause Test</h2>
            <AnimatedLogo size="lg" autoPlayDuration={2000} />
            <p className="text-sm text-gray-600 mt-2">Plays for 2 seconds, then pauses to static</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Direct GIF Test</h2>
            <Image
              src="/animations/logo-video.gif"
              alt="Direct GIF test"
              width={64}
              height={64}
              className="rounded-full object-cover shadow-lg mx-auto"
            />
          </div>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              🎯 <strong>Ultra-Slow Playback:</strong> Animation runs at 10% speed for elegant, gentle motion
            </p>
            <p className="text-sm text-blue-800 mt-2">
              ⏸️ <strong>Auto-Pause:</strong> Animation stops after 2 seconds and shows static logo
            </p>
            <p className="text-sm text-blue-600 mt-2">
              File location: <code>public/animations/logo-video.gif</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
