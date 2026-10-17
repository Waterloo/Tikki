const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "4 min. ago", "yesterday", then a date after a week. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return relative.format(0, 'minute')
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day')
  return shortDate.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return fullDate.format(new Date(iso))
}

export function formatDay(iso: string): string {
  return shortDate.format(new Date(iso))
}
