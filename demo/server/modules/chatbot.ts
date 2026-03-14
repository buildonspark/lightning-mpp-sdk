import type { Express } from 'express'
import type { AppContext } from '../index.js'
import { Credential } from 'mppx'
import { Mppx, spark, Store } from '../sdk.js'
import { toWebRequest } from '../utils.js'
import OpenAI from 'openai'

let openai: OpenAI | null = null

// Sats charged per SSE chunk (one chunk ≈ a few tokens)
const MODEL_RATES: Record<string, number> = {
  'gpt-4o-mini': 1,
  'gpt-4o':      2,
}
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEPOSIT_SATS = 500

export function register(app: Express, ctx: AppContext) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  const sessionMethod = spark.session({
    mnemonic: ctx.serverMnemonic,
    network: 'regtest',
    depositAmount: DEPOSIT_SATS,
    store: Store.memory(),
  })

  const mppx = Mppx.create({
    methods: [sessionMethod],
    secretKey: ctx.secretKey,
    realm: 'openai',
  })

  app.all('/api/v1/chatbot/chat', async (req, res) => {
    const model: string = MODEL_RATES[req.body?.model] !== undefined ? req.body.model : DEFAULT_MODEL
    const satsPerChunk = MODEL_RATES[model]!

    const webReq = toWebRequest(req)
    const result = await mppx.session({
      amount: String(satsPerChunk),
      currency: 'sat',
      description: `${model} stream`,
    })(webReq)

    if (result.status === 402) {
      const challenge = result.challenge
      res.status(402)
      challenge.headers.forEach((v, k) => res.setHeader(k, v))
      res.send(await challenge.text())
      return
    }

    // topUp and close are short-circuited by the session method's respond() hook
    const cred = Credential.fromRequest<{ action: string }>(webReq)
    if (cred.payload.action === 'topUp' || cred.payload.action === 'close') {
      const resp = result.withReceipt()
      res.status(resp.status)
      resp.headers.forEach((v, k) => res.setHeader(k, v))
      res.send(await resp.text())
      return
    }

    // Authenticated (open / bearer): stream the OpenAI response
    const { messages } = req.body as { messages: OpenAI.Chat.ChatCompletionMessageParam[] }

    async function* generate(): AsyncIterable<string> {
      const stream = await openai!.chat.completions.create({ model, messages, stream: true })
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content
        if (text) yield JSON.stringify({ text })
      }
    }

    const sseResponse = result.withReceipt(
      sessionMethod.serve({ request: webReq, generate: generate() }),
    )

    res.status(sseResponse.status)
    sseResponse.headers.forEach((v, k) => res.setHeader(k, v))
    if (sseResponse.body) {
      const reader = sseResponse.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } else {
      res.end()
    }
  })
}
