export function formatMoney(value: number | null | undefined, currency: string | null = 'INR') {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const code = currency || 'INR'
  if (code === 'INR') {
    if (value >= 10_000_000) return `Rs ${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Cr`
    if (value >= 100_000) return `Rs ${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)} L`
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(value)
}

export function formatAmountRange(
  min: number | null,
  max: number | null,
  currency: string | null = 'INR'
) {
  const low = formatMoney(min, currency)
  const high = formatMoney(max, currency)
  if (low && high) return low === high ? low : `${low} - ${high}`
  return low || high
}

export function formatDeadline(closeDate: string | null, isRolling: boolean) {
  if (isRolling) return 'Rolling'
  if (!closeDate) return null
  const date = new Date(closeDate)
  if (Number.isNaN(date.getTime())) return null
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000)
  const stamp = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  // The number of days left is the part that actually changes a decision.
  if (days >= 0 && days <= 90) return `Closes in ${days} day${days === 1 ? '' : 's'} · ${stamp}`
  return `Closes ${stamp}`
}

export function formatDuration(months: number | null | undefined) {
  if (!months || !Number.isFinite(months)) return null
  return months % 12 === 0 ? `${months / 12} yr` : `${months} mo`
}
