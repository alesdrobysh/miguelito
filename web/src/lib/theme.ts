export type Theme = 'light' | 'dark' | 'system'

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark')
}

export function loadTheme(): Theme {
  return (localStorage.getItem('theme') as Theme) ?? 'system'
}

export function saveTheme(theme: Theme) {
  localStorage.setItem('theme', theme)
}
