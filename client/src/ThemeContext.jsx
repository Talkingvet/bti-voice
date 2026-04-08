import { createContext, useContext, useState } from 'react'

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

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeCtx.Provider>
  )
}
