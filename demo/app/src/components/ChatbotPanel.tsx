import { useEffect, useRef, useState } from 'react'
import { MODELS } from '../endpoints'
import { useWindowWidth } from '../hooks'
import { getChatSession, streamChat } from '../wallet'

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#111' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `16px ${px}px`, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ color: '#333', fontSize: 12, textAlign: 'center', marginTop: 48, lineHeight: 2.2 }}>
            per-token billing via Lightning session<br />
            <span style={{ color: '#2a2a2a' }}>{modelInfo.rate} · 500 sat deposit · auto top-up</span>
          </div>
        )}
        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1
          const showCursor = isLastAssistant && busy
          const showLive = isLastAssistant && status === 'streaming' && liveSpent > 0

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {msg.role}
                </span>
                {msg.role === 'assistant' && msg.cost !== undefined && (
                  <span style={{ fontSize: 10, color: '#39ff14', letterSpacing: 0.3 }}>
                    {msg.cost} sat{msg.cost !== 1 ? 's' : ''} · {msg.model}
                    {msg.topUps ? <span style={{ color: '#ffb300' }}> · ⚡ {msg.topUps} top-up{msg.topUps !== 1 ? 's' : ''}</span> : null}
                  </span>
                )}
                {showLive && (
                  <span style={{ fontSize: 10, color: '#ffb300' }}>
                    {liveSpent} sat{liveSpent !== 1 ? 's' : ''}…
                    {msg.topUps ? <span> · ⚡ {msg.topUps} top-up{msg.topUps !== 1 ? 's' : ''}</span> : null}
                  </span>
                )}
                {isLastAssistant && status === 'topping-up' && (
                  <span style={{ fontSize: 10, color: '#ffb300' }}>
                    ⚡ topping up… {liveSpent} sats so far
                  </span>
                )}
              </div>
              <div style={{ color: msg.role === 'user' ? '#e0e0e0' : '#a0a0a0', fontSize: isMobile ? 14 : 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content}{showCursor ? <span style={{ color: status === 'topping-up' ? '#ffb300' : '#39ff14' }}>▋</span> : null}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Session status bar */}
      <div style={{ padding: `4px ${px}px`, fontSize: 10, color: '#444', borderTop: '1px solid #1a1a1a', minHeight: 22, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px' }}>
        {status === 'opening' && (
          <span style={{ color: '#ffb300' }}>⚡ opening session — paying {totalDeposited || 500} sat deposit...</span>
        )}
        {status === 'topping-up' && (
          <span style={{ color: '#ffb300' }}>⚡ topping up — paying new deposit...</span>
        )}
        {status !== 'opening' && status !== 'topping-up' && session && (
          <>
            {!isMobile && <span>session <span style={{ color: '#333' }}>{session.sessionId.slice(0, 12)}…</span></span>}
            <span>deposited <span style={{ color: '#555' }}>{totalDeposited} sats</span></span>
            <span>spent <span style={{ color: totalSpent + liveSpent > 0 ? '#39ff14' : '#333' }}>{totalSpent + liveSpent} sats</span></span>
            {(() => {
              const refund = totalDeposited - totalSpent - liveSpent
              return refund > 0
                ? <span>refundable <span style={{ color: '#00e5ff' }}>{refund} sats</span></span>
                : null
            })()}
          </>
        )}
        {errorMsg && <span style={{ color: '#ff3b3b' }}>✗ {errorMsg}</span>}
      </div>

      {/* Input area */}
      <div style={{ padding: `8px ${px}px`, borderTop: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={inputRef}
            style={{ background: '#1a1a1a', border: '1px solid #222', color: '#b0b0b0', padding: '8px 12px', fontFamily: 'inherit', fontSize: isMobile ? 15 : 13, borderRadius: 2, outline: 'none', flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={walletReady ? 'Type a message...' : 'initializing wallet...'}
            disabled={busy || !walletReady}
          />
          <button
            style={{ background: '#39ff14', color: '#000', border: 'none', padding: '8px 16px', fontFamily: 'inherit', fontSize: isMobile ? 14 : 13, fontWeight: 'bold', cursor: busy || !walletReady ? 'not-allowed' : 'pointer', borderRadius: 2, letterSpacing: 0.5, opacity: busy || !walletReady ? 0.4 : 1 }}
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
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', fontFamily: 'inherit', fontSize: 11, padding: '4px 8px', borderRadius: 2, cursor: busy ? 'not-allowed' : 'pointer', outline: 'none' }}
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
