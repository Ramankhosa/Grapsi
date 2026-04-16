'use client'

import { useState } from 'react'

interface DateRangePickerProps {
  value: { from: Date; to: Date }
  onChange: (range: { from: Date; to: Date }) => void
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const handlePresetSelect = (preset: string) => {
    const now = new Date()
    let from: Date

    switch (preset) {
      case '7d':
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      default:
        from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    onChange({ from, to: now })
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <div className="flex items-center space-x-2">
      <select
        onChange={(e) => handlePresetSelect(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        defaultValue="30d"
      >
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="month">This month</option>
      </select>
      <span className="text-sm text-gray-600">
        {formatDate(value.from)} - {formatDate(value.to)}
      </span>
    </div>
  )
}
