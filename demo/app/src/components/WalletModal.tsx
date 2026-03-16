import { useEffect, useRef, useState } from 'react'
import { loadMnemonic } from '../wallet'

const M = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace"

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
          <span style={s.title}>Wallet</span>
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
    position: 'fixed', inset: 0,
    background: 'rgba(7,7,20,0.85)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, zIndex: 100,
  },
  card: {
    background: '#111111',
    border: '1px solid #1E1E1E',
    borderRadius: 10,
    padding: '24px 28px',
    width: '100%', maxWidth: 400,
    fontFamily: M, fontSize: 13, color: '#E8E8E8',
    boxShadow: '0 32px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 24,
  },
  title: {
    fontFamily: M, color: '#E8E8E8', fontWeight: 700,
    fontSize: 16, letterSpacing: '-0.02em',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#333333',
    cursor: 'pointer', fontFamily: M, fontSize: 16, padding: 0, lineHeight: 1,
    transition: 'color 0.15s',
  },
  row: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 20,
  },
  section: { marginBottom: 20 },
  label: {
    color: '#444444', fontSize: 10,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
  },
  value: { color: '#4ADE80', fontWeight: 700, fontSize: 16 },
  addressBox: {
    background: '#0A0A0A', border: '1px solid #1E1E1E',
    borderRadius: 4, padding: '10px 12px',
    fontSize: 11, wordBreak: 'break-all', lineHeight: 1.7,
    marginBottom: 10, color: '#E8E8E8',
  },
  btn: {
    background: '#161616', border: '1px solid #1E1E1E',
    color: '#666666', fontFamily: M, fontSize: 11,
    cursor: 'pointer', padding: '5px 14px', borderRadius: 4,
  },
  btnActive: { color: '#4ADE80', borderColor: 'rgba(74,222,128,0.4)' },
  hint: { color: '#444444', fontSize: 11, lineHeight: 1.7, marginBottom: 10 },
  faucetLink: {
    display: 'block', color: '#06D6A0', fontSize: 12,
    textDecoration: 'none', padding: '8px 12px',
    border: '1px solid rgba(6,214,160,0.2)',
    borderRadius: 4, background: 'rgba(6,214,160,0.05)', textAlign: 'center',
  },
  divider: { borderTop: '1px solid #161616', margin: '20px 0 16px' },
  resetBtn: {
    background: 'transparent', border: '1px solid rgba(244,63,94,0.2)',
    color: 'rgba(244,63,94,0.5)', fontFamily: M, fontSize: 11,
    cursor: 'pointer', padding: '7px 12px', borderRadius: 4,
    width: '100%', letterSpacing: '0.03em',
    transition: 'color 0.15s, border-color 0.15s',
  },
}
