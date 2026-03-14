import type { Request as ExpressRequest } from 'express'

export function toWebRequest(req: ExpressRequest): Request {
  const url = `${req.protocol}://${req.get('host') ?? 'localhost:3000'}${req.originalUrl}`
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value
    else if (Array.isArray(value)) headers[key] = value.join(', ')
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
  })
}
