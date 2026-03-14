import { useEffect, useRef, useState } from 'react'
import { loadMnemonic } from '../wallet'

export function WalletModal({
  sparkAddress,
  balance,
  onReset,
  onClose,
}: {
  sparkAddress: string
  balance: number | null
  onReset: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'address' | 'mnemonic' | null>(null)
  const mnemonic = loadMnemonic()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  function copy(text: string, which: 'address' | 'mnemonic') {
    navigator.clipboard.writeText(text)
    setCopied(which)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>wallet</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.row}>
          <span style={s.label}>balance</span>
          <span style={s.value}>{balance ?? '…'} sats</span>
        </div>

        <div style={s.section}>
          <div style={s.label}>spark address</div>
          <div style={s.addressBox}>{sparkAddress || '…'}</div>
          <button
            style={{ ...s.btn, ...(copied === 'address' ? s.btnActive : {}) }}
            onClick={() => copy(sparkAddress, 'address')}
          >
            {copied === 'address' ? 'copied!' : 'copy address'}
          </button>
        </div>

        <div style={s.section}>
          <div style={s.label}>recovery phrase</div>
          <button
            style={{ ...s.btn, ...(copied === 'mnemonic' ? s.btnActive : {}) }}
            onClick={() => mnemonic && copy(mnemonic, 'mnemonic')}
          >
            {copied === 'mnemonic' ? 'copied!' : 'copy recovery phrase'}
          </button>
        </div>

        <div style={s.section}>
          <div style={s.label}>get test funds</div>
          <div style={s.hint}>
            Copy your spark address above, then visit the Lightspark REGTEST faucet to receive free test sats.
          </div>
          <a
            href="https://app.lightspark.com/regtest-faucet"
            target="_blank"
            rel="noopener noreferrer"
            style={s.faucetLink}
          >
            app.lightspark.com/regtest-faucet ↗
          </a>
        </div>

        <div style={s.divider} />

        <button style={s.resetBtn} onClick={onReset}>
          reset wallet
        </button>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 100,
  },
  card: {
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    padding: '24px 28px',
    width: '100%',
    maxWidth: 400,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
    fontSize: 13,
    color: '#c0c0c0',
    boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#39ff14',
    fontWeight: 'bold',
    fontSize: 15,
    letterSpacing: -0.2,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 16,
    padding: 0,
    lineHeight: 1,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    color: '#555',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  value: {
    color: '#39ff14',
    fontWeight: 'bold',
    fontSize: 15,
  },
  addressBox: {
    background: '#0d0d0d',
    border: '1px solid #222',
    borderRadius: 2,
    padding: '10px 12px',
    fontSize: 11,
    wordBreak: 'break-all',
    lineHeight: 1.7,
    marginBottom: 10,
    color: '#e0e0e0',
  },
  btn: {
    background: '#1e1e1e',
    border: '1px solid #333',
    color: '#999',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    padding: '5px 14px',
    borderRadius: 2,
  },
  btnActive: {
    color: '#39ff14',
    borderColor: '#39ff14',
  },
  hint: {
    color: '#666',
    fontSize: 11,
    lineHeight: 1.7,
    marginBottom: 10,
  },
  faucetLink: {
    display: 'block',
    color: '#00e5ff',
    fontSize: 12,
    textDecoration: 'none',
    padding: '8px 12px',
    border: '1px solid #00e5ff33',
    borderRadius: 2,
    background: '#00e5ff08',
    textAlign: 'center',
  },
  divider: {
    borderTop: '1px solid #1e1e1e',
    margin: '20px 0 16px',
  },
  resetBtn: {
    background: 'transparent',
    border: '1px solid #2a1010',
    color: '#883333',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    padding: '7px 12px',
    borderRadius: 2,
    width: '100%',
    letterSpacing: 0.3,
  },
}
