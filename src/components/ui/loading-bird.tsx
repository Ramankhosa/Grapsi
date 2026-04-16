import React from 'react'
import AnimatedLogo from './animated-logo'

interface LoadingBirdProps {
  size?: 'sm' | 'md' | 'lg'
  message?: string
  className?: string
  overlay?: boolean
  fullScreen?: boolean
  useKishoFallback?: boolean
}

export default function LoadingBird({
  size = 'md',
  message = 'Loading...',
  className = '',
  overlay = false,
  fullScreen = false,
  useKishoFallback = false
}: LoadingBirdProps) {
  const content = (
    <div className={`flex flex-col items-center justify-center space-y-4 ${className}`}>
      <AnimatedLogo size={size} className="flex-shrink-0" useKishoFallback={useKishoFallback} />
      {message && (
        <p className="text-sm text-gray-600 animate-pulse">
          {message}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white bg-opacity-90 flex items-center justify-center z-50">
        {content}
      </div>
    )
  }

  if (overlay) {
    return (
      <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
        {content}
      </div>
    )
  }

  return content
}

// Specialized loading components for different use cases
export function PageLoadingBird({
  message = 'Loading page...',
  useKishoFallback = false
}: {
  message?: string
  useKishoFallback?: boolean
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <LoadingBird size="lg" message={message} useKishoFallback={useKishoFallback} />
    </div>
  )
}

export function ButtonLoadingBird({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <AnimatedLogo size={size} className="animate-spin" />
}

export function CardLoadingBird({ message = 'Loading content...' }: { message?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-8">
      <LoadingBird size="md" message={message} />
    </div>
  )
}

export function InlineLoadingBird({ size = 'sm', message }: { size?: 'sm' | 'md' | 'lg', message?: string }) {
  return (
    <div className="flex items-center space-x-2">
      <AnimatedLogo size={size} />
      {message && <span className="text-sm text-gray-600">{message}</span>}
    </div>
  )
}
