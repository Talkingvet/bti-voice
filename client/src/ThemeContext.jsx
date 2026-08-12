import { createContext, useContext, useState, useEffect } from 'react'

const ThemeCtx = createContext({ theme: 'dark', toggleTheme: () => {} })

export const useTheme = () => useContext(ThemeCtx)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('bti_theme') || 'dark'
  )

  function toggleTheme() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem('bti_theme', next)
      return next
    })
  }

  // Apply the theme to the document itself. Without this, the body background
  // (and anything the React root doesn't paint) stays the hard-coded dark color
  // even in light mode.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.style.background = theme === 'dark' ? '#161b24' : '#f4f6f9'
    document.body.style.color      = theme === 'dark' ? '#e6eaf1' : '#1e293b'
  }, [theme])

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeCtx.Provider>
  )
}
