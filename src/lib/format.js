const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function money(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isNaN(n) ? String(v) : `$${n.toFixed(2).replace(/\.00$/, '')}`
}

export function fmtTime(t) {
  if (!t) return ''
  const m = String(t).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return String(t)
  let h = parseInt(m[1], 10)
  const min = m[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

export function dayName(dayOfWeek) {
  return DAYS[dayOfWeek] || ''
}
