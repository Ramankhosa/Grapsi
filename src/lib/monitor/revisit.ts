export function revisitDays(input: { lifecycle: string; deadline?: string | null; firstSeen: Date; seasonalMonth?: number | null; inventoryRank?: number }, now = new Date()) {
  if ((input.inventoryRank ?? 0) > 1000) return 90
  if (input.seasonalMonth && Math.abs(now.getUTCMonth() + 1 - input.seasonalMonth) <= 1) return 7
  const age = (now.getTime() - input.firstSeen.getTime()) / 86400_000
  const until = input.deadline ? (Date.parse(input.deadline) - now.getTime()) / 86400_000 : null
  if (until !== null && until >= 0 && until <= 14) return 1
  if (['EXPIRED', 'WITHDRAWN', 'CANCELLED'].includes(input.lifecycle)) return until !== null && until >= -60 ? 7 : 30
  if (['UNKNOWN', 'ROLLING'].includes(input.lifecycle) && age > 90) return 30
  return 3
}
