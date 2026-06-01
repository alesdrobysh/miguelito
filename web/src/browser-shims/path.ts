// Browser shim for Node.js 'path' module

export function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

export function resolve(...parts: string[]): string {
  return '/' + parts.join('/').replace(/\/+/g, '/').replace(/^\/+/, '')
}

export function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx < 0 ? '.' : p.slice(0, idx) || '/'
}

export function basename(p: string, ext?: string): string {
  const base = p.split('/').pop() ?? ''
  if (ext && base.endsWith(ext)) return base.slice(0, -ext.length)
  return base
}

export default { join, resolve, dirname, basename }
