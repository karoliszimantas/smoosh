import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { attributionOf, isSignedInAttribution } from '@smoosh/protocol'
import AdminNav from './AdminNav'
import { adminPageOf, isAdminPath, redirectOldAdminPaths } from './paths'
import { previewImport } from '../prompts/importParse'

afterEach(() => vi.unstubAllGlobals())

describe('admin nav', () => {
  const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  it('shows only the sections the server says — no logs for the base list', () => {
    const base = renderToStaticMarkup(<AdminNav sections={['prompts', 'labels']} current="prompts" onGo={() => {}} />)
    expect(links(base)).toEqual(['/admin/prompts', '/admin/labels'])
    expect(base).not.toContain('Logs')
    const logs = renderToStaticMarkup(<AdminNav sections={['prompts', 'labels', 'logs']} current="logs" onGo={() => {}} />)
    expect(links(logs)).toEqual(['/admin/prompts', '/admin/labels', '/admin/logs'])
    expect(logs).toMatch(/aria-current="page"[^>]*>Logs</)
  })
})

describe('admin paths', () => {
  it('knows its pages', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/logs/')).toBe(true)
    expect(isAdminPath('/administer')).toBe(false)
    expect(isAdminPath('/prompts')).toBe(false)
    expect(adminPageOf('/admin/labels')).toBe('labels')
    expect(adminPageOf('/admin/break-glass')).toBe('break-glass')
    expect(adminPageOf('/admin')).toBe(null)
    expect(adminPageOf('/admin/nope')).toBe(null)
  })

  function at(href: string) {
    const url = new URL(href)
    const replaced: string[] = []
    const removed: string[] = []
    vi.stubGlobal('window', {
      location: { pathname: url.pathname, search: url.search, hash: url.hash },
      history: { state: null, replaceState: (_s: unknown, _t: string, to: string) => replaced.push(to) },
    })
    vi.stubGlobal('localStorage', { removeItem: (k: string) => removed.push(k) })
    redirectOldAdminPaths()
    return { replaced, removed }
  }

  it('old /prompts and /labels links land in /admin — the code on them dropped, and any stored one forgotten', () => {
    expect(at('https://x.test/prompts?code=letmein').replaced).toEqual(['/admin/prompts'])
    expect(at('https://x.test/labels/').replaced).toEqual(['/admin/labels'])
    expect(at('https://x.test/prompts').removed).toEqual(['smoosh_prompt_code', 'smoosh_prompt_name'])
    expect(at('https://x.test/').replaced).toEqual([])
    expect(at('https://x.test/admin/prompts').replaced).toEqual([])
  })
})

describe('credit', () => {
  it('a signed-in account is @ and its local part; a typed name never starts with @', () => {
    expect(attributionOf('karolis@example.com')).toBe('@karolis')
    expect(isSignedInAttribution('@karolis')).toBe(true)
    expect(isSignedInAttribution('Karolis')).toBe(false)
  })

  it('an import preview lets the importer’s own credit through, and turns away a typed @', () => {
    const rows = [
      { line: 1, text: 'Mine', mode: null, author: null },
      { line: 2, text: 'Forged', mode: null, author: '@someone' },
      { line: 3, text: 'Friend', mode: null, author: 'Mia' },
    ]
    const preview = previewImport(rows, [], { me: '@a-rather-long-local-part-here', importAllAs: '' })
    expect(preview.map((r) => [r.author, r.status])).toEqual([
      ['@a-rather-long-local-part-here', 'new'],
      ['@someone', 'invalid'],
      ['Mia', 'new'],
    ])
  })
})
