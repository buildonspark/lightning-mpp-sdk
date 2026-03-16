import { useEffect, useRef, useState } from 'react'
import { generateWallet, getWallet, importWallet } from '../wallet'

const M = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace"

type SetupScreen = 'start' | 'generated' | 'recovering'

export function WalletSetup({ onDone }: { onDone: () => void }) {
  const [screen, setScreen] = useState<SetupScreen>('start')
  const [mnemonic, setMnemonic] = useState('')
  const [recoverInput, setRecoverInput] = useState('')
  const [recoverError, setRecoverError] = useState('')
  const [sparkAddress, setSparkAddress] = useState('')
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'claiming' | 'claimed' | 'failed'>('idle')
  const [copied, setCopied] = useState<'mnemonic' | 'address' | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  function copyText(text: string, which: 'mnemonic' | 'address') {
    navigator.clipboard.writeText(text)
    setCopied(which)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(null), 1500)
  }

  async function claimFaucet(addr: string) {
    setFaucetStatus('claiming')
    try {
      const res = await fetch('/api/v1/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sparkAddress: addr }),
      })
      setFaucetStatus(res.ok ? 'claimed' : 'failed')
    } catch {
      setFaucetStatus('failed')
    }
  }

  async function handleGenerate() {
    const m = generateWallet()
    setMnemonic(m)
    setScreen('generated')
    try {
      const wallet = await getWallet()
      const addr = await wallet.getSparkAddress()
      setSparkAddress(addr)
      await claimFaucet(addr)
    } catch {
      setFaucetStatus('failed')
    }
  }

  function handleRecover() {
    setRecoverError('')
    try {
      importWallet(recoverInput.trim())
      onDone()
    } catch (e: unknown) {
      setRecoverError(e instanceof Error ? e.message : String(e))
    }
  }

  if (screen === 'start') {
    return (
      <div style={s.root}>
        {/* Grid bg */}
        <div style={s.gridBg} />
        <div style={s.glow} />
        <div style={s.card}>
          <div style={s.logoRow}>
            <span style={{ color: '#F59E0B', fontSize: 22 }}>⚡</span>
            <span style={s.logoText}>lightning-mpp</span>
          </div>
          <h2 style={s.title}>Connect wallet</h2>
          <p style={s.subtitle}>A Spark wallet is required to make Lightning payments in the playground.</p>
          <div style={s.btnGroup}>
            <button style={s.primaryBtn} onClick={handleGenerate}>
              Generate new wallet
            </button>
            <button style={s.secondaryBtn} onClick={() => setScreen('recovering')}>
              Recover existing wallet
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'generated') {
    return (
      <div style={s.root}>
        <div style={s.gridBg} />
        <div style={s.glow} />
        <div style={s.card}>
          <div style={s.logoRow}>
            <span style={{ color: '#F59E0B', fontSize: 22 }}>⚡</span>
            <span style={s.logoText}>lightning-mpp</span>
          </div>
          <h2 style={s.title}>Wallet created</h2>
          <div style={s.label}>Save your recovery phrase</div>
          <div style={s.mnemonicBox}>
            {mnemonic.split(' ').map((word, i) => (
              <span key={i} style={s.mnemonicWord}>
                <span style={s.mnemonicNum}>{i + 1}.</span> {word}
              </span>
            ))}
          </div>
          <button
            style={{ ...s.copyBtn, ...(copied === 'mnemonic' ? s.copyBtnActive : {}) }}
            onClick={() => copyText(mnemonic, 'mnemonic')}
          >
            {copied === 'mnemonic' ? 'copied!' : 'copy phrase'}
          </button>

          {sparkAddress && (
            <div style={{ marginTop: 22 }}>
              <div style={s.label}>Your Spark address</div>
              <div style={s.addressBox}>{sparkAddress}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  style={{ ...s.copyBtn, ...(copied === 'address' ? s.copyBtnActive : {}) }}
                  onClick={() => copyText(sparkAddress, 'address')}
                >
                  {copied === 'address' ? 'copied!' : 'copy address'}
                </button>
                <a
                  href="https://app.lightspark.com/regtest-faucet"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.faucetLink}
                >
                  lightspark regtest faucet ↗
                </a>
              </div>
              <div style={s.faucetHint}>
                paste your spark address above to get free REGTEST funds
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {faucetStatus === 'claiming' && (
              <div style={s.faucetMsg}>⚡ claiming 1000 sats from demo faucet...</div>
            )}
            {faucetStatus === 'claimed' && (
              <div style={{ ...s.faucetMsg, color: '#4ADE80' }}>
                ✓ 1000 sats credited from demo faucet
              </div>
            )}
            {faucetStatus === 'failed' && (
              <div style={{ ...s.faucetMsg, color: '#F59E0B' }}>
                demo faucet unavailable — use the lightspark faucet above
              </div>
            )}
          </div>

          <button style={{ ...s.primaryBtn, marginTop: 22 }} onClick={onDone}>
            Enter Playground →
          </button>
        </div>
      </div>
    )
  }

  // screen === 'recovering'
  return (
    <div style={s.root}>
      <div style={s.gridBg} />
      <div style={s.glow} />
      <div style={s.card}>
        <div style={s.logoRow}>
          <span style={{ color: '#F59E0B', fontSize: 22 }}>⚡</span>
          <span style={s.logoText}>lightning-mpp</span>
        </div>
        <h2 style={s.title}>Recover wallet</h2>
        <div style={s.label}>Enter your 12-word recovery phrase</div>
        <textarea
          style={s.textarea}
          value={recoverInput}
          onChange={(e) => setRecoverInput(e.target.value)}
          placeholder="word1 word2 word3 ... word12"
          rows={3}
        />
        {recoverError && <div style={s.error}>{recoverError}</div>}
        <div style={s.btnGroup}>
          <button style={s.primaryBtn} onClick={handleRecover}>
            Import wallet
          </button>
          <button style={s.secondaryBtn} onClick={() => setScreen('start')}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: M,
    fontSize: 13,
    background: '#0A0A0A',
    color: '#E8E8E8',
    height: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  gridBg: {
    position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
    backgroundImage: 'linear-gradient(#1E1E1E 1px, transparent 1px), linear-gradient(90deg, #1E1E1E 1px, transparent 1px)',
    backgroundSize: '52px 52px', opacity: 0.35,
    maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 70%)',
    WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 0%, transparent 70%)',
  },
  glow: {
    position: 'absolute', top: '20%', left: '50%',
    transform: 'translateX(-50%)',
    width: 600, height: 400,
    background: 'radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 60%)',
    zIndex: 0, pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: '#111111',
    border: '1px solid #1E1E1E',
    borderRadius: 10,
    padding: '36px 34px',
    width: '100%',
    maxWidth: 460,
    boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  logoRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24,
  },
  logoText: {
    fontFamily: M, fontSize: 15, fontWeight: 700,
    letterSpacing: '-0.03em', color: '#E8E8E8',
  },
  title: {
    fontFamily: M, color: '#E8E8E8', fontWeight: 700,
    fontSize: 22, marginBottom: 8, letterSpacing: '-0.03em',
  },
  subtitle: {
    color: '#555555', fontSize: 12, marginBottom: 30, lineHeight: 1.7,
  },
  label: {
    color: '#444444', fontSize: 10, textTransform: 'uppercase',
    letterSpacing: '0.08em', marginBottom: 8,
  },
  btnGroup: {
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  primaryBtn: {
    background: '#F59E0B', color: '#000', border: 'none',
    padding: '12px 16px', fontFamily: M, fontSize: 14,
    fontWeight: 700, cursor: 'pointer', borderRadius: 6,
    letterSpacing: '-0.01em', width: '100%',
    transition: 'opacity 0.15s',
  },
  secondaryBtn: {
    background: 'transparent', color: '#666666',
    border: '1px solid #1E1E1E', padding: '12px 16px',
    fontFamily: M, fontSize: 13, cursor: 'pointer',
    borderRadius: 6, width: '100%',
  },
  mnemonicBox: {
    background: '#0A0A0A', border: '1px solid #1E1E1E',
    borderRadius: 6, padding: '16px',
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px 16px', marginBottom: 12,
  },
  mnemonicWord: { color: '#E8E8E8', fontSize: 13 },
  mnemonicNum: {
    color: '#333333', fontSize: 10, marginRight: 4,
    display: 'inline-block', minWidth: 16, textAlign: 'right',
  },
  addressBox: {
    background: '#0A0A0A', border: '1px solid #1E1E1E',
    borderRadius: 5, padding: '10px 12px',
    color: '#E8E8E8', fontSize: 11,
    wordBreak: 'break-all', lineHeight: 1.7,
  },
  copyBtn: {
    background: '#161616', border: '1px solid #1E1E1E',
    color: '#666666', fontFamily: M, fontSize: 11,
    cursor: 'pointer', padding: '5px 14px', borderRadius: 4,
  },
  copyBtnActive: { color: '#4ADE80', borderColor: 'rgba(74,222,128,0.4)' },
  faucetLink: {
    color: '#06D6A0', fontSize: 12, textDecoration: 'none',
    padding: '5px 14px', border: '1px solid rgba(6,214,160,0.25)',
    borderRadius: 4, background: 'rgba(6,214,160,0.05)', display: 'inline-block',
  },
  faucetHint: { color: '#444444', fontSize: 11, marginTop: 8, lineHeight: 1.6 },
  faucetMsg: { fontSize: 12, color: '#666666' },
  textarea: {
    background: '#0A0A0A', border: '1px solid #1E1E1E',
    color: '#E8E8E8', fontFamily: M, fontSize: 13,
    padding: '10px 12px', borderRadius: 5, width: '100%',
    resize: 'vertical', outline: 'none', marginBottom: 8,
    boxSizing: 'border-box', lineHeight: 1.6,
  },
  error: { color: '#F43F5E', fontSize: 12, marginBottom: 10 },
}
