import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { clearWallet, getWallet, loadMnemonic, payAndFetch } from './wallet'
import { ChatbotPanel } from './components/ChatbotPanel'
import { CodeBlock } from './components/CodeBlock'
import { WalletModal } from './components/WalletModal'
import { WalletSetup } from './components/WalletSetup'
import { Landing } from './Landing'
import { ENDPOINTS, MODELS, buildSnippet, buildChatSnippet } from './endpoints'
import { useWindowWidth } from './hooks'
import type { Endpoint, Kind, LogLine, MobileTab, View } from './types'
import { MOBILE_TABS } from './types'

const M = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace"

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/playground" element={<PlaygroundRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function PlaygroundRoute() {
  const navigate = useNavigate()
  const [walletExists, setWalletExists] = useState(() => loadMnemonic() !== null)

  if (!walletExists) {
    return <WalletSetup onDone={() => setWalletExists(true)} />
  }

  return <MainApp onClearWallet={() => { clearWallet(); setWalletExists(false); navigate('/') }} />
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function MainApp({ onClearWallet }: { onClearWallet: () => void }) {
  const [view, setView] = useState<View>('chatbot')
  const [lines, setLines] = useState<LogLine[]>([])
  const [selected, setSelected] = useState<Endpoint>(ENDPOINTS[0])
  const [params, setParams] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [totalReqs, setTotalReqs] = useState(0)
  const [totalSats, setTotalSats] = useState(0)
  const [walletReady, setWalletReady] = useState(false)
  const [sparkAddress, setSparkAddress] = useState<string>('')
  const [selectedChatModel, setSelectedChatModel] = useState(MODELS[0].id)
  const [codeOpen, setCodeOpen] = useState(() => window.innerWidth >= 640)
  const [mobileTab, setMobileTab] = useState<MobileTab>('api')
  const [copied, setCopied] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640

  const addLine = useCallback((text: string, kind: Kind) => {
    setLines((prev) => {
      const next = [...prev, { id: idRef.current++, text, kind }]
      return next.length > 500 ? next.slice(-500) : next
    })
  }, [])

  // Auto-scroll terminal
  useEffect(() => {
    const el = terminalRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  // Initialize wallet on mount
  useEffect(() => {
    addLine('initializing spark wallet...', 'info')
    getWallet()
      .then(async (wallet) => {
        setWalletReady(true)
        addLine('wallet ready ✓', 'ok')
        const [{ balance }, addr] = await Promise.all([wallet.getBalance(), wallet.getSparkAddress()])
        setBalance(Number(balance))
        setSparkAddress(addr)
      })
      .catch((e) => addLine(`wallet init failed: ${e.message}`, 'error'))
  }, [addLine])

  // Cleanup copy timer on unmount
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  // Initialize params when endpoint changes
  useEffect(() => {
    const defaults: Record<string, string> = {}
    for (const p of selected.params) defaults[p.name] = p.default
    setParams(defaults)
  }, [selected])

  const refreshBalance = useCallback(() => {
    getWallet()
      .then((w) => w.getBalance())
      .then(({ balance }) => setBalance(Number(balance)))
      .catch(() => {})
  }, [])

  const selectEndpoint = useCallback((ep: Endpoint) => {
    setView('explorer')
    setSelected(ep)
    setMobileTab('terminal')
  }, [])

  const run = useCallback(async () => {
    if (running || !walletReady) return
    setRunning(true)

    const path = selected.path(params)
    const body = selected.body?.(params, sparkAddress)
    let amountPaid = 0

    for await (const step of payAndFetch(path, selected.method, body)) {
      switch (step.type) {
        case 'request':
          addLine(`→ ${step.method} ${step.url}`, 'req')
          break
        case 'challenge':
          addLine(`← 402 Payment Required`, '402')
          addLine(`  invoice: ${step.invoice.slice(0, 50)}...`, 'dim')
          addLine(`  amount:  ${step.amountSats} sat${step.amountSats !== 1 ? 's' : ''}`, 'dim')
          amountPaid = step.amountSats
          break
        case 'paying':
          addLine(`  paying via Spark...`, 'dim')
          break
        case 'paid':
          addLine(`← payment confirmed ✓`, 'ok')
          addLine(`  preimage: ${step.preimage}`, 'dim')
          break
        case 'retry':
          addLine(`→ retrying with credential`, 'req')
          break
        case 'success':
          addLine(`← ${step.status} OK  (${step.durationMs}ms total)`, 'ok')
          addLine(JSON.stringify(step.body, null, 2), 'info')
          setTotalReqs((n) => n + 1)
          setTotalSats((n) => n + amountPaid)
          refreshBalance()
          break
        case 'error':
          addLine(`✗ ${step.message}`, 'error')
          break
      }
    }

    setRunning(false)
  }, [running, walletReady, selected, params, sparkAddress, addLine, refreshBalance])

  const snippet = useMemo(
    () => view === 'chatbot'
      ? buildChatSnippet(selectedChatModel, window.location.origin)
      : buildSnippet(selected, params, window.location.origin),
    [view, selectedChatModel, selected, params],
  )

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
  }, [snippet])

  // ─── Composed UI fragments ─────────────────────────────────────────────────

  const sidebar = (
    <div style={{ ...s.sidebar, ...(isMobile ? { width: '100%', minWidth: 0 } : {}) }}>
      <div>
        <div style={s.moduleLabel}>OpenAI</div>
        <div
          style={{ ...s.endpointRow, ...(view === 'chatbot' ? s.endpointActive : {}) }}
          onClick={() => { setView('chatbot'); setMobileTab('terminal') }}
        >
          <span>
            <span style={{ ...s.methodBadge, color: '#F59E0B' }}>POST</span>
            /chat
          </span>
          <span style={s.cost}>1–5 sats/chunk</span>
        </div>
      </div>
      {['Stocks', 'Lottery'].map((module) => (
        <div key={module}>
          <div style={s.moduleLabel}>{module}</div>
          {ENDPOINTS.filter((ep) => ep.module === module).map((ep) => (
            <div
              key={ep.label}
              style={{ ...s.endpointRow, ...(view === 'explorer' && ep === selected ? s.endpointActive : {}) }}
              onClick={() => selectEndpoint(ep)}
            >
              <span>
                <span style={{ ...s.methodBadge, color: ep.method === 'POST' ? '#F59E0B' : '#06D6A0' }}>
                  {ep.method}
                </span>
                {ep.label}
              </span>
              <span style={s.cost}>{ep.cost}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  const codeToggleBtn = (
    <button
      style={{
        ...s.clearBtn,
        ...(codeOpen ? { color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.06)' } : {}),
        marginLeft: 'auto',
      }}
      onClick={() => setCodeOpen((o) => !o)}
    >
      {'</>'}
    </button>
  )

  const controlsBar = (
    <div style={s.controls}>
      {selected.params.map((p) => (
        <label key={p.name} style={s.paramLabel}>
          {p.name}
          <input
            style={s.input}
            value={params[p.name] ?? p.default}
            placeholder={p.placeholder}
            onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
          />
        </label>
      ))}
      <div style={s.btnRow}>
        <button
          style={{ ...s.runBtn, ...(running || !walletReady ? s.runBtnDisabled : {}) }}
          onClick={run}
          disabled={running || !walletReady}
        >
          {running ? 'running...' : 'Run'}
        </button>
        <button style={s.clearBtn} onClick={() => setLines([])}>Clear</button>
        {!isMobile && codeToggleBtn}
      </div>
    </div>
  )

  const terminalPane = (
    <div style={s.terminal} ref={terminalRef}>
      {lines.map((line) => (
        <div key={line.id} style={{ ...s.line, ...kindStyle(line.kind) }}>{line.text}</div>
      ))}
    </div>
  )

  const codePane = (desktop: boolean) => (
    <div style={{ ...s.codePane, ...(desktop ? s.codePaneDesktop : {}), position: 'relative' }}>
      <button style={s.copyBtn} onClick={handleCopy}>
        {copied ? 'copied!' : 'copy'}
      </button>
      <pre style={s.codeBody}><CodeBlock code={snippet} /></pre>
    </div>
  )

  const walletBtn = (
    <button style={s.walletBtn} onClick={() => setWalletModalOpen(true)}>
      wallet: <span style={s.val}>{walletReady ? `${balance ?? '…'} sats` : 'initializing…'}</span>
    </button>
  )

  const modal = walletModalOpen && (
    <WalletModal
      sparkAddress={sparkAddress}
      balance={balance}
      onReset={() => { setWalletModalOpen(false); onClearWallet() }}
      onClose={() => setWalletModalOpen(false)}
    />
  )

  // ─── Mobile layout ─────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <div style={s.root}>
        {modal}
        <div style={s.tabBar}>
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab}
              style={{ ...s.tabBtn, ...(mobileTab === tab ? s.tabBtnActive : {}) }}
              onClick={() => setMobileTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {mobileTab === 'api' && sidebar}
          {mobileTab === 'terminal' && (
            <>
              <div style={{ flex: 1, display: view === 'chatbot' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                <ChatbotPanel walletReady={walletReady} onBalanceChange={refreshBalance} selectedModel={selectedChatModel} onModelChange={setSelectedChatModel} />
              </div>
              <div style={{ flex: 1, display: view === 'explorer' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                {controlsBar}
                {terminalPane}
              </div>
            </>
          )}
          {mobileTab === 'code' && codePane(false)}
        </div>
        <div style={s.statusBar}>
          {walletBtn}
          <span>spent: <span style={s.val}>{totalSats} sats</span></span>
        </div>
      </div>
    )
  }

  // ─── Desktop layout ────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      {modal}
      <div style={s.main}>
        {sidebar}
        <div style={{ ...s.panel, display: view === 'chatbot' ? 'flex' : 'none' }}>
          <div style={s.controls}>
            {codeToggleBtn}
          </div>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <ChatbotPanel walletReady={walletReady} onBalanceChange={refreshBalance} selectedModel={selectedChatModel} onModelChange={setSelectedChatModel} />
            {codeOpen && codePane(true)}
          </div>
        </div>
        <div style={{ ...s.panel, display: view !== 'chatbot' ? 'flex' : 'none' }}>
          {controlsBar}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {terminalPane}
            {codeOpen && codePane(true)}
          </div>
        </div>
      </div>
      <div style={s.statusBar}>
        {walletBtn}
        <span>requests: <span style={s.val}>{totalReqs}</span>{'  '}spent: <span style={s.val}>{totalSats} sats</span></span>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function kindStyle(kind: Kind): React.CSSProperties {
  switch (kind) {
    case 'req':   return { color: '#06D6A0' }
    case '402':   return { color: '#F59E0B' }
    case 'ok':    return { color: '#4ADE80' }
    case 'error': return { color: '#F43F5E' }
    case 'dim':   return { color: '#333333' }
    case 'info':  return { color: '#777777' }
  }
}

const s: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: M,
    fontSize: 13,
    background: '#0A0A0A',
    color: '#E8E8E8',
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  main: { flex: 1, display: 'flex', minHeight: 0 },
  sidebar: {
    width: 260,
    minWidth: 260,
    background: '#0A0A0A',
    borderRight: '1px solid #1E1E1E',
    overflowY: 'auto',
    paddingTop: 12,
    flex: 'none',
  },
  moduleLabel: {
    padding: '6px 16px',
    color: '#F59E0B',
    fontWeight: 700,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  endpointRow: {
    padding: '8px 16px 8px 24px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'background 0.1s',
  },
  endpointActive: { background: '#1A1A1A', color: '#F59E0B' },
  methodBadge: { fontSize: 10, fontWeight: 700, marginRight: 6 },
  cost: { color: '#333333', fontSize: 11 },
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#111111',
    minWidth: 0,
  },
  controls: {
    padding: '8px 16px',
    borderBottom: '1px solid #1E1E1E',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    background: '#0A0A0A',
  },
  paramLabel: { display: 'flex', alignItems: 'center', gap: 6, color: '#444444', fontSize: 11 },
  input: {
    background: '#161616',
    border: '1px solid #1E1E1E',
    color: '#E8E8E8',
    padding: '4px 8px',
    fontFamily: M,
    fontSize: 13,
    borderRadius: 3,
    outline: 'none',
  },
  btnRow: { display: 'flex', gap: 8, alignItems: 'center', flex: 1 },
  runBtn: {
    background: '#F59E0B',
    color: '#000',
    border: 'none',
    padding: '5px 18px',
    fontFamily: M,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    borderRadius: 3,
    letterSpacing: '0.03em',
  },
  clearBtn: {
    background: '#161616',
    color: '#444444',
    border: '1px solid #1E1E1E',
    padding: '5px 16px',
    fontFamily: M,
    fontSize: 12,
    cursor: 'pointer',
    borderRadius: 3,
  },
  runBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  codePane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#0A0A0A',
    minWidth: 0,
    overflowY: 'auto',
  },
  codePaneDesktop: { borderLeft: '1px solid #1E1E1E' },
  copyBtn: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    background: '#161616',
    border: '1px solid #1E1E1E',
    color: '#444444',
    fontFamily: M,
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: 3,
    zIndex: 1,
  },
  codeBody: {
    margin: 0,
    padding: '10px 16px',
    fontFamily: M,
    fontSize: 12,
    lineHeight: 1.7,
    overflowX: 'auto',
  },
  terminal: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 18px',
    lineHeight: 1.75,
    background: '#111111',
  },
  line: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  statusBar: {
    padding: '6px 18px',
    borderTop: '1px solid #1E1E1E',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#444444',
    background: '#0A0A0A',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #1E1E1E',
    background: '#0A0A0A',
  },
  tabBtn: {
    flex: 1,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#444444',
    fontFamily: M,
    fontSize: 12,
    padding: '10px 0',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  tabBtnActive: {
    color: '#F59E0B',
    borderBottomColor: '#F59E0B',
  },
  val: { color: '#4ADE80' },
  walletBtn: {
    background: 'none',
    border: 'none',
    color: '#444444',
    fontFamily: M,
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    textDecorationColor: '#282828',
    textUnderlineOffset: 3,
  },
}
