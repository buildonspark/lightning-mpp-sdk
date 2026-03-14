import { useEffect, useRef, useState } from 'react'
import { generateWallet, getWallet, importWallet } from '../wallet'

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
        <div style={s.card}>
          <div style={s.title}>lightning-mpp demo</div>
          <div style={s.subtitle}>connect a spark wallet to get started</div>
          <div style={s.btnGroup}>
            <button style={s.primaryBtn} onClick={handleGenerate}>
              generate new wallet
            </button>
            <button style={s.secondaryBtn} onClick={() => setScreen('recovering')}>
              recover existing wallet
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'generated') {
    return (
      <div style={s.root}>
        <div style={s.card}>
          <div style={s.title}>wallet created</div>
          <div style={s.label}>save your recovery phrase</div>
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
            <div style={{ marginTop: 20 }}>
              <div style={s.label}>your spark address</div>
              <div style={s.addressBox}>{sparkAddress}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
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
              <div style={s.faucetMsg}>claiming 1000 sats from demo faucet...</div>
            )}
            {faucetStatus === 'claimed' && (
              <div style={{ ...s.faucetMsg, color: '#39ff14' }}>
                1000 sats credited from demo faucet ✓
              </div>
            )}
            {faucetStatus === 'failed' && (
              <div style={{ ...s.faucetMsg, color: '#ffb300' }}>
                demo faucet unavailable — use the lightspark faucet above
              </div>
            )}
          </div>

          <button style={{ ...s.primaryBtn, marginTop: 20 }} onClick={onDone}>
            continue →
          </button>
        </div>
      </div>
    )
  }

  // screen === 'recovering'
  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.title}>recover wallet</div>
        <div style={s.label}>enter your 12-word recovery phrase</div>
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
            import wallet
          </button>
          <button style={s.secondaryBtn} onClick={() => setScreen('start')}>
            back
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
    fontSize: 13,
    background: '#0a0a0a',
    color: '#c0c0c0',
    height: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    padding: '36px 32px',
    width: '100%',
    maxWidth: 460,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
  },
  title: {
    color: '#39ff14',
    fontWeight: 'bold',
    fontSize: 20,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
    marginBottom: 32,
  },
  label: {
    color: '#666',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  btnGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  primaryBtn: {
    background: '#39ff14',
    color: '#000',
    border: 'none',
    padding: '12px 16px',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: 'pointer',
    borderRadius: 2,
    letterSpacing: 0.5,
    width: '100%',
  },
  secondaryBtn: {
    background: 'transparent',
    color: '#777',
    border: '1px solid #2a2a2a',
    padding: '12px 16px',
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 2,
    width: '100%',
  },
  mnemonicBox: {
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: 2,
    padding: '16px',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px 16px',
    marginBottom: 12,
  },
  mnemonicWord: {
    color: '#e8e8e8',
    fontSize: 13,
  },
  mnemonicNum: {
    color: '#444',
    fontSize: 10,
    marginRight: 4,
    display: 'inline-block',
    minWidth: 16,
    textAlign: 'right',
  },
  addressBox: {
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: 2,
    padding: '10px 12px',
    color: '#e8e8e8',
    fontSize: 11,
    wordBreak: 'break-all',
    lineHeight: 1.7,
  },
  copyBtn: {
    background: '#1e1e1e',
    border: '1px solid #333',
    color: '#999',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    padding: '5px 14px',
    borderRadius: 2,
  },
  copyBtnActive: {
    color: '#39ff14',
    borderColor: '#39ff14',
  },
  faucetLink: {
    color: '#00e5ff',
    fontSize: 12,
    textDecoration: 'none',
    padding: '5px 14px',
    border: '1px solid #00e5ff33',
    borderRadius: 2,
    background: '#00e5ff0a',
    display: 'inline-block',
  },
  faucetHint: {
    color: '#555',
    fontSize: 11,
    marginTop: 8,
    lineHeight: 1.6,
  },
  faucetMsg: {
    fontSize: 12,
    color: '#777',
  },
  textarea: {
    background: '#0d0d0d',
    border: '1px solid #2a2a2a',
    color: '#e8e8e8',
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
    fontSize: 13,
    padding: '10px 12px',
    borderRadius: 2,
    width: '100%',
    resize: 'vertical',
    outline: 'none',
    marginBottom: 8,
    boxSizing: 'border-box',
    lineHeight: 1.6,
  },
  error: {
    color: '#ff5555',
    fontSize: 12,
    marginBottom: 10,
  },
}
