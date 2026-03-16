import type { Endpoint } from './types'

export const ENDPOINTS: Endpoint[] = [
  {
    module: 'Stocks',
    label: '/quote/:symbol',
    method: 'GET',
    path: (p) => `/api/v1/stocks/quote/${p.symbol || 'AAPL'}`,
    cost: '10 sats',
    params: [{ name: 'symbol', placeholder: 'AAPL', default: 'AAPL' }],
  },
  {
    module: 'Stocks',
    label: '/search?q=',
    method: 'GET',
    path: (p) => `/api/v1/stocks/search?q=${encodeURIComponent(p.q || 'apple')}`,
    cost: '10 sats',
    params: [{ name: 'q', placeholder: 'apple', default: 'apple' }],
  },
  {
    module: 'Stocks',
    label: '/history/:symbol',
    method: 'GET',
    path: (p) => `/api/v1/stocks/history/${p.symbol || 'AAPL'}?range=${p.range || '1mo'}`,
    cost: '50 sats',
    params: [
      { name: 'symbol', placeholder: 'AAPL', default: 'AAPL' },
      { name: 'range', placeholder: '1mo', default: '1mo' },
    ],
  },
  {
    module: 'Lottery',
    label: '/status',
    method: 'GET',
    path: () => `/api/v1/lottery/status`,
    cost: 'free',
    free: true,
    params: [],
  },
  {
    module: 'Lottery',
    label: '/buy',
    method: 'POST',
    path: () => `/api/v1/lottery/buy`,
    cost: '10 sats',
    params: [],
    body: (_p, sparkAddr) => ({ sparkAddress: sparkAddr }),
  },
]

export function buildChatSnippet(model: string, origin: string): string {
  return [
    `import OpenAI from 'openai'`,
    `import { Mppx, spark } from '@buildonspark/lightning-mpp-sdk/client'`,
    ``,
    `const sessionMethod = spark.session({`,
    `  mnemonic: process.env.MNEMONIC!,`,
    `  network: 'regtest',`,
    `})`,
    `const mppx = Mppx.create({ methods: [sessionMethod] })`,
    ``,
    `// Inject mppx as the fetcher — Lightning payments handled transparently.`,
    `// Note: responses that exceed the session deposit will be truncated.`,
    `// For long responses, increase depositAmount or use mppx.fetch directly.`,
    `const openai = new OpenAI({`,
    `  baseURL: '${origin}/api/v1/openai',`,
    `  apiKey: 'lightning',`,
    `  fetch: mppx.fetch.bind(mppx),`,
    `})`,
    ``,
    `const stream = await openai.chat.completions.create({`,
    `  model: '${model}',`,
    `  messages: [{ role: 'user', content: 'Hello!' }],`,
    `  stream: true,`,
    `})`,
    ``,
    `for await (const chunk of stream) {`,
    `  process.stdout.write(chunk.choices?.[0]?.delta?.content ?? '')`,
    `}`,
    ``,
    `await sessionMethod.cleanup()`,
  ].join('\n')
}

export const MODELS: { id: string; label: string; rate: string }[] = [
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', rate: '1 sat/chunk' },
  { id: 'gpt-4o',      label: 'gpt-4o',      rate: '2 sats/chunk' },
]

export function buildSnippet(ep: Endpoint, params: Record<string, string>, origin: string): string {
  const path = ep.path(params)

  if (ep.free) {
    return [
      `const BASE_URL = '${origin}'`,
      ``,
      `const res = await fetch(`,
      `  BASE_URL + '${path}',`,
      `)`,
      `console.log(await res.json())`,
    ].join('\n')
  }

  const bodyLines = ep.body
    ? (() => {
        const body = ep.body(params, '<your-spark-address>')
        return [
          `  BASE_URL + '${path}',`,
          `  {`,
          `    method: 'POST',`,
          `    headers: {`,
          `      'Content-Type': 'application/json',`,
          `    },`,
          `    body: JSON.stringify({`,
          ...Object.entries(body).map(([k, v]) => `      ${k}: '${v}',`),
          `    }),`,
          `  },`,
        ]
      })()
    : [`  BASE_URL + '${path}',`]

  return [
    `import { Mppx, spark } from '@buildonspark/lightning-mpp-sdk/client'`,
    ``,
    `const BASE_URL = '${origin}'`,
    `const mppx = Mppx.create({`,
    `  methods: [`,
    `    spark.charge({`,
    `      mnemonic: process.env.MNEMONIC!,`,
    `      network: 'regtest',`,
    `    }),`,
    `  ],`,
    `})`,
    ``,
    `const res = await mppx.fetch(`,
    ...bodyLines,
    `)`,
    `console.log(await res.json())`,
  ].join('\n')
}
