export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { ...init, credentials: 'same-origin' })
  if (r.status === 204) return undefined as T
  const d = await r.json().catch(() => null)
  if (!r.ok) {
    const det = d?.detail
    const msg = typeof det === 'string' ? det : Array.isArray(det) ? 'Please check the fields and try again.' : det?.message ?? 'Something went wrong.'
    throw new ApiError(r.status, det?.code ?? 'ERROR', msg)
  }
  return d as T
}

export const api = <T>(path: string, opts: { method?: string; body?: unknown } = {}) =>
  send<T>(path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'trackline' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })

// File uploads: the browser sets the multipart Content-Type itself, so it must not be set here.
export const apiUpload = <T>(path: string, form: FormData) =>
  send<T>(path, { method: 'POST', headers: { 'X-Requested-With': 'trackline' }, body: form })

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
