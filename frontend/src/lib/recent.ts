const KEY = 'stockpulse:recent-symbols'

export function readRecentSymbols(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 8)
  } catch {
    return []
  }
}

export function rememberSymbol(symbol: string) {
  try {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return
    const next = [normalized, ...readRecentSymbols().filter((item) => item !== normalized)].slice(0, 8)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage may be unavailable; recent history is non-critical.
  }
}
