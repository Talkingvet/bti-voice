import { useTheme } from './ThemeContext'

/**
 * Returns theme-appropriate color values.
 * Dark palette is inspired by Zoho Voice — dark charcoal/slate, NOT navy blue.
 */
export function useColors() {
  const { theme } = useTheme()
  const d = theme === 'dark'
  return {
    // ── Page / panel backgrounds ──────────────────────────────────
    bg:          d ? '#161b24'                    : '#f4f6f9',
    panel:       d ? '#1d2330'                    : '#ffffff',
    panelAlt:    d ? '#141920'                    : '#f0f3f8',
    surface:     d ? '#252d3c'                    : '#f0f4f9',
    hover:       d ? 'rgba(255,255,255,0.04)'     : '#f5f8fc',
    active:      d ? 'rgba(79,156,249,0.12)'      : '#e8f1fd',

    // ── Borders ───────────────────────────────────────────────────
    border:      d ? 'rgba(255,255,255,0.08)'     : '#dde3ee',
    borderSoft:  d ? 'rgba(255,255,255,0.05)'     : '#eaeff6',
    borderItem:  d ? 'rgba(255,255,255,0.05)'     : '#edf1f8',

    // ── Text ──────────────────────────────────────────────────────
    text:        d ? '#e8edf5'                    : '#1e293b',
    textSec:     d ? '#8b96ab'                    : '#5a6a85',
    textMuted:   d ? 'rgba(255,255,255,0.28)'     : '#96a3b8',

    // ── Inputs ────────────────────────────────────────────────────
    searchBg:    d ? 'rgba(255,255,255,0.07)'     : '#edf1f8',
    inputBg:     d ? '#252d3c'                    : '#ffffff',
    inputBorder: d ? 'rgba(255,255,255,0.10)'     : '#d0d8e8',
    inputText:   d ? '#e8edf5'                    : '#1e293b',

    // ── Buttons ───────────────────────────────────────────────────
    btnBg:       d ? '#252d3c'                    : '#ffffff',
    btnBorder:   d ? 'rgba(255,255,255,0.10)'     : '#d4dce8',
    btnText:     d ? '#c8d0de'                    : '#475569',

    // ── Message area ──────────────────────────────────────────────
    msgBg:       d ? '#12161f'                    : '#f4f6f9',
    bubbleIn:    d ? '#252d3c'                    : '#ffffff',
    bubbleInBorder: d ? 'rgba(255,255,255,0.07)' : '#dde3ee',

    // ── Bottom nav / chrome ───────────────────────────────────────
    navBg:       d ? '#1d2330'                    : '#ffffff',
    navBorder:   d ? 'rgba(255,255,255,0.07)'     : '#dde3ee',
    navIcon:     d ? 'rgba(255,255,255,0.38)'     : '#6b7c9a',
    navLabel:    d ? 'rgba(255,255,255,0.28)'     : '#8a98b4',

    // ── Misc ──────────────────────────────────────────────────────
    divider:     d ? 'rgba(255,255,255,0.07)'     : '#dde3ee',
    emptyText:   d ? 'rgba(255,255,255,0.18)'     : '#b0bcd4',
    fromBadge:   d ? 'rgba(255,255,255,0.07)'     : '#edf1f8',
    fromText:    d ? '#8b96ab'                    : '#5a6a85',
  }
}
