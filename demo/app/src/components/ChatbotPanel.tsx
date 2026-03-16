import { useEffect, useRef, useState } from 'react'
import { MODELS } from '../endpoints'
import { useWindowWidth } from '../hooks'
import { getChatSession, streamChat } from '../wallet'

const M = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace"

type ChatMessage = { role: 'user' | 'assistant'; content: string; cost?: number; model?: string; topUps?: number }
type ChatStatus = 'idle' | 'opening' | 'streaming' | 'topping-up'

export function ChatbotPanel({
  walletReady,
  onBalanceChange,
}: {
  walletReady: boolean
  onBalanceChange: () => void
}) {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id)
  const [totalDeposited, setTotalDeposited] = useState(0)
  const [totalSpent, setTotalSpent] = useState(0)
  const [liveSpent, setLiveSpent] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const liveSpentRef = useRef(0)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || status !== 'idle' || !walletReady) return
    setErrorMsg(null)
    liveSpentRef.current = 0
    setLiveSpent(0)
    const userContent = input.trim()
    setInput('')

    const chatHistory = messages
      .filter((m): m is Extract<ChatMessage, { role: 'user' | 'assistant' }> =>
        m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }))
      .concat({ role: 'user', content: userContent })

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userContent },
      { role: 'assistant', content: '', model: selectedModel },
    ])

    let currentSatsPerChunk = 1

    try {
      for await (const step of streamChat(chatHistory, selectedModel)) {
        switch (step.type) {
          case 'opening':
            setStatus('opening')
            setTotalDeposited(step.depositSats)
            currentSatsPerChunk = step.satsPerChunk
            break
          case 'ready':
            currentSatsPerChunk = step.satsPerChunk
            break
          case 'chunk':
            setStatus('streaming')
            liveSpentRef.current += currentSatsPerChunk
            setLiveSpent(liveSpentRef.current)
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role !== 'assistant') return prev
              return [...prev.slice(0, -1), { ...last, content: last.content + step.text }]
            })
            break
          case 'topup-start':
            setStatus('topping-up')
            break
          case 'topup-done':
            setTotalDeposited((n) => n + step.topUpSats)
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role !== 'assistant') return prev
              return [...prev.slice(0, -1), { ...last, topUps: (last.topUps ?? 0) + 1 }]
            })
            setStatus('streaming')
            break
          case 'done':
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role !== 'assistant') return prev
              return [...prev.slice(0, -1), { ...last, cost: step.spent }]
            })
            setTotalSpent((n) => n + step.spent)
            setLiveSpent(0)
            setStatus('idle')
            onBalanceChange()
            inputRef.current?.focus()
            break
          case 'error':
            setErrorMsg(step.message)
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              return last?.role === 'assistant' && !last.content ? prev.slice(0, -1) : prev
            })
            setLiveSpent(0)
            setStatus('idle')
            break
        }
      }
      // Ensure the UI is never left in a non-idle state if the stream closes
      // without emitting a `done` or `error` event (e.g. server timeout, dropped connection).
      setStatus('idle')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('idle')
    }
  }

  const session = getChatSession()
  const busy = status !== 'idle'
  const modelInfo = MODELS.find((m) => m.id === selectedModel)!
  const px = isMobile ? 14 : 24

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#111111' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `16px ${px}px`, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.length === 0 && (
          <div style={{ color: '#555555', fontSize: 12, textAlign: 'center', marginTop: 48, lineHeight: 2.2, fontFamily: M }}>
            per-token billing via Lightning session<br />
            <span style={{ color: '#444444' }}>{modelInfo.rate} · 500 sat deposit · auto top-up</span>
          </div>
        )}
        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1
          const showCursor = isLastAssistant && busy
          const showLive = isLastAssistant && status === 'streaming' && liveSpent > 0

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: M, fontSize: 10, color: '#333333', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {msg.role}
                </span>
                {msg.role === 'assistant' && msg.cost !== undefined && (
                  <span style={{ fontFamily: M, fontSize: 10, color: '#4ADE80', letterSpacing: '0.02em' }}>
                    {msg.cost} sat{msg.cost !== 1 ? 's' : ''} · {msg.model}
                    {msg.topUps ? <span style={{ color: '#F59E0B' }}> · ⚡ {msg.topUps} top-up{msg.topUps !== 1 ? 's' : ''}</span> : null}
                  </span>
                )}
                {showLive && (
                  <span style={{ fontFamily: M, fontSize: 10, color: '#F59E0B' }}>
                    {liveSpent} sat{liveSpent !== 1 ? 's' : ''}…
                    {msg.topUps ? <span> · ⚡ {msg.topUps} top-up{msg.topUps !== 1 ? 's' : ''}</span> : null}
                  </span>
                )}
                {isLastAssistant && status === 'topping-up' && (
                  <span style={{ fontFamily: M, fontSize: 10, color: '#F59E0B' }}>
                    ⚡ topping up… {liveSpent} sats so far
                  </span>
                )}
              </div>
              <div style={{ color: msg.role === 'user' ? '#E8E8E8' : '#AAAAAA', fontSize: isMobile ? 14 : 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: M }}>
                {msg.content}{showCursor ? <span style={{ color: status === 'topping-up' ? '#F59E0B' : '#4ADE80' }}>▋</span> : null}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Session status bar */}
      <div style={{ padding: `4px ${px}px`, fontSize: 10, color: '#333333', borderTop: '1px solid #161616', minHeight: 22, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', fontFamily: M, background: '#0A0A0A' }}>
        {status === 'opening' && (
          <span style={{ color: '#F59E0B' }}>⚡ opening session — paying {totalDeposited || 500} sat deposit...</span>
        )}
        {status === 'topping-up' && (
          <span style={{ color: '#F59E0B' }}>⚡ topping up — paying new deposit...</span>
        )}
        {status !== 'opening' && status !== 'topping-up' && session && (
          <>
            {!isMobile && <span>session <span style={{ color: '#1E1E1E' }}>{session.sessionId.slice(0, 12)}…</span></span>}
            <span>deposited <span style={{ color: '#444444' }}>{totalDeposited} sats</span></span>
            <span>spent <span style={{ color: totalSpent + liveSpent > 0 ? '#4ADE80' : '#1E1E1E' }}>{totalSpent + liveSpent} sats</span></span>
            {(() => {
              const refund = totalDeposited - totalSpent - liveSpent
              return refund > 0
                ? <span>refundable <span style={{ color: '#06D6A0' }}>{refund} sats</span></span>
                : null
            })()}
          </>
        )}
        {errorMsg && <span style={{ color: '#F43F5E' }}>✗ {errorMsg}</span>}
      </div>

      {/* Input area */}
      <div style={{ padding: `8px ${px}px`, borderTop: '1px solid #1E1E1E', display: 'flex', flexDirection: 'column', gap: 6, background: '#0A0A0A' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={inputRef}
            style={{ background: '#161616', border: '1px solid #1E1E1E', color: '#E8E8E8', padding: '8px 12px', fontFamily: M, fontSize: isMobile ? 15 : 13, borderRadius: 4, outline: 'none', flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={walletReady ? 'Type a message...' : 'initializing wallet...'}
            disabled={busy || !walletReady}
          />
          <button
            style={{ background: '#F59E0B', color: '#000', border: 'none', padding: '8px 18px', fontFamily: M, fontSize: isMobile ? 14 : 13, fontWeight: 700, cursor: busy || !walletReady ? 'not-allowed' : 'pointer', borderRadius: 4, letterSpacing: '0.03em', opacity: busy || !walletReady ? 0.35 : 1 }}
            onClick={send}
            disabled={busy || !walletReady}
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={busy}
            style={{ background: '#161616', border: '1px solid #1E1E1E', color: '#444444', fontFamily: M, fontSize: 11, padding: '4px 8px', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', outline: 'none' }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label} ({m.rate})</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
