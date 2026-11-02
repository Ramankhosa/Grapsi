/** Shared by the form and API: wall-clock dates always carry an explicit IANA zone. */
export function validTimeZone(zone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true } catch { return false }
}

export function localDateTime(value: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function localToUtc(value: string, zone: string): Date {
  if (!validTimeZone(zone)) throw new Error('Choose a valid time zone.')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid date and time.')
  const base = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 16) !== value) throw new Error('Enter a valid date and time.')
  // Both sides of a daylight-saving transition are tested. Ambiguous and
  // nonexistent wall times are rejected instead of silently moving a reminder.
  const offsets = new Set<number>()
  for (const hours of [-36, 0, 36]) {
    const sample = base + hours * 3600000
    offsets.add(Date.parse(`${localDateTime(new Date(sample), zone)}:00Z`) - sample)
  }
  const matches = [...offsets].map(offset => new Date(base - offset)).filter(date => localDateTime(date, zone) === value)
  if (matches.length !== 1) throw new Error('This time changes with daylight saving. Choose another time.')
  return matches[0]
}
