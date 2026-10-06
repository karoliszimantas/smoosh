// The prompt list's "Access code" and the writer's display name, kept on
// this device so nobody is asked twice. The code is a shared password the
// server checks; the name is attribution, not security.

const CODE_KEY = 'smoosh_prompt_code'
const NAME_KEY = 'smoosh_prompt_name'

export function isPromptsPath(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/prompts'
}

// the asset labelling tool — the same three people, the same code and name
export function isLabelsPath(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/labels'
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // private browsing — they'll be asked again next time, nothing worse
  }
}

export const getCode = () => read(CODE_KEY)
export const setCode = (code: string) => write(CODE_KEY, code.trim())
export const getName = () => read(NAME_KEY)
export const setName = (name: string) => write(NAME_KEY, name.trim().replace(/\s+/g, ' '))

// A Telegram link can carry the code: /prompts?code=… — stored, then
// stripped from the address bar straight away (before the first render), so
// it isn't in a screenshot of the page
export function captureCodeFromUrl(): void {
  if (!isPromptsPath() && !isLabelsPath()) return
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (code === null) return
  if (code.trim()) setCode(code)
  url.searchParams.delete('code')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
