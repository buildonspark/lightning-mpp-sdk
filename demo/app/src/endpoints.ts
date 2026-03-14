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
    `import { Mppx, spark } from 'spark-mppx/client'`,
    ``,
    `const BASE_URL = '${origin}'`,
    `const mppx = Mppx.create({`,
    `  methods: [`,
    `    spark.charge({`,
    `      mnemonic: process.env.MNEMONIC!,`,
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
