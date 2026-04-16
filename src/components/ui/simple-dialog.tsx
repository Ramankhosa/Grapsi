"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SimpleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

interface SimpleDialogContentProps {
  className?: string
  children: React.ReactNode
}

interface SimpleDialogHeaderProps {
  className?: string
  children: React.ReactNode
}

interface SimpleDialogTitleProps {
  className?: string
  children: React.ReactNode
}

interface SimpleDialogDescriptionProps {
  className?: string
  children: React.ReactNode
}

interface SimpleDialogFooterProps {
  className?: string
  children: React.ReactNode
}

interface SimpleDialogTriggerProps {
  className?: string
  children: React.ReactNode
  onClick?: () => void
}

const SimpleDialog: React.FC<SimpleDialogProps> = ({ open, onOpenChange, children }) => {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false)
      }
    }

    if (open) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog content will be rendered by children */}
      {children}
    </div>
  )
}

const SimpleDialogContent: React.FC<SimpleDialogContentProps> = ({ className, children }) => (
  <div
    className={cn(
      "relative z-50 grid w-full max-w-lg gap-4 border border-gray-200 bg-white p-6 shadow-2xl sm:rounded-lg",
      className
    )}
  >
    {children}
  </div>
)

const SimpleDialogHeader: React.FC<SimpleDialogHeaderProps> = ({ className, children }) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}>
    {children}
  </div>
)

const SimpleDialogTitle: React.FC<SimpleDialogTitleProps> = ({ className, children }) => (
  <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
    {children}
  </h2>
)

const SimpleDialogDescription: React.FC<SimpleDialogDescriptionProps> = ({ className, children }) => (
  <p className={cn("text-sm text-muted-foreground", className)}>
    {children}
  </p>
)

const SimpleDialogFooter: React.FC<SimpleDialogFooterProps> = ({ className, children }) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}>
    {children}
  </div>
)

const SimpleDialogTrigger: React.FC<SimpleDialogTriggerProps> = ({ className, children, onClick }) => (
  <button className={className} onClick={onClick}>
    {children}
  </button>
)

const SimpleDialogClose: React.FC<{ className?: string; onClick?: () => void }> = ({ className, onClick }) => (
  <button
    className={cn(
      "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none",
      className
    )}
    onClick={onClick}
  >
    <X className="h-4 w-4" />
    <span className="sr-only">Close</span>
  </button>
)

export {
  SimpleDialog,
  SimpleDialogContent,
  SimpleDialogHeader,
  SimpleDialogTitle,
  SimpleDialogDescription,
  SimpleDialogFooter,
  SimpleDialogTrigger,
  SimpleDialogClose,
}



















