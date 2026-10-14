// Colour themes for the pane. One button steps through them in order.
//
// Hues are mid-tones so they read on light and dark backgrounds. `accent` marks what
// needs attention (the open card, decisions, started items); `tint` is the hue the
// desktop draws behind things at low alpha; project, session and age colour the meta
// line. The terminal cannot draw alpha, so there only the text colours apply.
export interface Theme {
  id: string
  label: string
  // A colour name from the person's own Claude theme, or a hex.
  accent: string
  // Hex, for the alpha tints (this-session rows, the pane wash).
  tint: string
  project: string
  session: string
  age: string
}

export const THEMES: readonly Theme[] = [
  // Follows the person's own Claude theme for its accent.
  { id: 'ledger', label: 'Ledger', accent: 'suggestion', tint: '#8b9cf7', project: '#5b8fd9', session: '#a57fd6', age: '#4fa88a' },
  // Cool teal and sky over a deep-sea wash.
  { id: 'aurora', label: 'Aurora', accent: '#14b8a6', tint: '#14b8a6', project: '#0ea5e9', session: '#8b5cf6', age: '#65a30d' },
  // Warm orange and rose, like embers.
  { id: 'ember', label: 'Ember', accent: '#f97316', tint: '#f97316', project: '#ec4899', session: '#f59e0b', age: '#ef4444' },
  // Fresh green with teal and lime.
  { id: 'forest', label: 'Forest', accent: '#22c55e', tint: '#22c55e', project: '#14b8a6', session: '#84cc16', age: '#eab308' },
  // Neutral slate: one quiet hue, for a calm list.
  { id: 'graphite', label: 'Graphite', accent: '#94a3b8', tint: '#94a3b8', project: '#94a3b8', session: '#cbd5e1', age: '#64748b' },
]

export function themeById(id: unknown): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function nextTheme(id: string): Theme {
  const at = THEMES.findIndex((t) => t.id === id)
  return THEMES[(at + 1) % THEMES.length]
}

// `#rrggbb` plus a two-digit alpha: the desktop's translucent colours.
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  return hex + a.toString(16).padStart(2, '0')
}
