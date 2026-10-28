export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, message: string, detail: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function extractMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg)
        return String(item)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object' && 'detail' in detail) return extractMessage((detail as { detail: unknown }).detail)
  return 'Something went wrong. Please try again.'
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(path, { credentials: 'include', ...init, signal: init.signal ?? controller.signal })
    if (!response.ok) {
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      const message = extractMessage(body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : body)
      if (response.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/me')) {
        window.dispatchEvent(new Event('stockpulse:unauthorized'))
      }
      throw new ApiError(response.status, message, body)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(408, 'The request timed out. Provider calls can be slow; retry in a moment.', null)
    }
    throw new ApiError(0, 'Network error. Check that the API is running.', error)
  } finally {
    window.clearTimeout(timer)
  }
}

export function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== 'GET' && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (method !== 'GET') headers.set('X-Requested-With', 'stockpulse')
  return request<T>(path, { ...init, headers })
}

export function upload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form, headers: { 'X-Requested-With': 'stockpulse' } })
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function del<T>(path: string): Promise<T> {
  return api<T>(path, { method: 'DELETE' })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unexpected error'
}
