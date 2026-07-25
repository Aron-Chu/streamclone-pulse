import type { Plugin } from 'vite'

/**
 * React Router embeds `http://localhost` as a relative-URL parse base.
 * Rewrite it in production builds to a non-local reserved origin so portal
 * assets never ship a bare localhost literal that could mask real leaks.
 */
export const REACT_ROUTER_URL_BASE = 'https://invalid.invalid'

export function rewriteReactRouterLocalhostPlugin(): Plugin {
  return {
    name: 'rewrite-react-router-localhost',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/')
      if (!/node_modules\/(?:react-router(?:-dom)?)\//.test(normalized)) return null
      if (!code.includes('http://localhost')) return null
      return {
        code: code.split('http://localhost').join(REACT_ROUTER_URL_BASE),
        map: null,
      }
    },
  }
}
