"use client"

import React, { useEffect, useRef } from "react"

type StepState = "ok" | "running" | "queued" | "error" | undefined

export type ActivityStep = {
  id: string
  state?: StepState
  label?: string
}

function titleCase(s: string) {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function humanizeSuffix(raw: string) {
  const map: Record<string, string> = {
    summary: "Summary",
    briefDescriptionOfDrawings: "Drawings",
    fieldOfInvention: "Field",
    background: "Background",
  }
  return map[raw] ?? titleCase(raw)
}

export function humanizeStep(raw: string) {
  if (raw === "load_context") return "Context"
  if (raw === "integrity_check") return "Integrity"

  const prefixes = [
    { key: "build_prompt_", label: "Prompt: " },
    { key: "llm_call_", label: "Drafting: " },
    { key: "parse_", label: "Parsing: " },
    { key: "guard_", label: "Checking: " },
    { key: "pair_guard_", label: "Checking: " },
    { key: "limit_enforce_", label: "Refining: " },
  ] as const

  for (const p of prefixes) {
    if (raw.startsWith(p.key)) {
      const suffix = raw.slice(p.key.length)
      return p.label + humanizeSuffix(suffix)
    }
  }

  return titleCase(raw)
}

function StateIcon({ state }: { state?: StepState }) {
  if (state === "ok") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" className="text-emerald-500 flex-shrink-0">
        <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
    )
  }
  if (state === "error") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" className="text-rose-500 flex-shrink-0">
        <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
    )
  }
  if (state === "queued") {
    return (
      <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
    )
  }
  // running or undefined
  return (
    <div className="relative w-3 h-3 flex-shrink-0">
      <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30" />
      <div className="absolute inset-0 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
    </div>
  )
}

export default function BackendActivityPanel({
  steps,
  isVisible,
  onClose
}: {
  steps: ActivityStep[]
  isVisible: boolean
  onClose?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to right when new steps add
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [steps])

  if (!isVisible) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-full bg-white/80 backdrop-blur border border-indigo-100 shadow-sm max-w-xl animate-fade-in">
      <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 whitespace-nowrap border-r border-indigo-100 pr-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
        </span>
        AI Drafting
      </div>

      <div 
        ref={scrollRef}
        className="flex items-center gap-4 overflow-x-auto no-scrollbar mask-linear-fade"
        style={{ scrollBehavior: 'smooth' }}
      >
        {steps.length === 0 && (
          <span className="text-xs text-gray-400 italic">Initializing...</span>
        )}
        {steps.map((s) => (
          <div key={s.id} className={`flex items-center gap-1.5 whitespace-nowrap transition-opacity duration-300 ${s.state === 'queued' ? 'opacity-40' : 'opacity-100'}`}>
            <StateIcon state={s.state} />
            <span className={`text-xs ${s.state === 'ok' ? 'text-gray-500' : 'text-gray-800 font-medium'}`}>
              {s.label || humanizeStep(s.id)}
            </span>
          </div>
        ))}
      </div>
      
      {onClose && (
        <button 
          onClick={onClose}
          className="ml-auto p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
          title="Hide activity"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
