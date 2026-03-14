export type LogLine = { id: number; text: string; kind: Kind }
export type Kind = 'req' | '402' | 'ok' | 'error' | 'info' | 'dim'

export interface Endpoint {
  module: string
  label: string
  method: 'GET' | 'POST'
  path: (p: Record<string, string>) => string
  cost: string
  free?: boolean
  params: { name: string; placeholder: string; default: string }[]
  body?: (p: Record<string, string>, sparkAddress: string) => Record<string, unknown>
}

export const MOBILE_TABS = ['api', 'terminal', 'code'] as const
export type MobileTab = typeof MOBILE_TABS[number]

export type View = 'explorer' | 'chatbot'
