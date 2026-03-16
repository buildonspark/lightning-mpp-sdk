import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWindowWidth } from './hooks'

const M = "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace"

const C = {
  bg: '#0A0A0A',
  surface: '#111111',
  surfaceHi: '#161616',
  border: '#1E1E1E',
  borderHi: '#282828',
  accent: '#F59E0B',
  codeKeyword: '#B0B0B0',
  codeString: '#7AC47A',
  codeClass: '#F59E0B',
  codeComment: '#3A3A3A',
  codeOk: '#7AC47A',
  codeText: '#E8E8E8',
  codeDim: '#555555',
  text: '#E8E8E8',
  textDim: '#666666',
}

const CODE_TOKENS: { t: string; c: string }[] = [
  { t: 'import', c: C.codeKeyword }, { t: ' { Mppx, spark } ', c: C.codeText },
  { t: 'from', c: C.codeKeyword }, { t: " '@buildonspark/lightning-mpp-sdk/client'\n\n", c: C.codeString },
  { t: 'const', c: C.codeKeyword }, { t: ' mppx ', c: C.codeText },
  { t: '= ', c: C.codeDim }, { t: 'Mppx', c: C.codeClass },
  { t: '.create({\n', c: C.codeDim },
  { t: '  methods: [spark.charge({\n', c: C.codeText },
  { t: '    mnemonic: ', c: C.codeText }, { t: 'process.env', c: C.codeKeyword },
  { t: '.MNEMONIC', c: C.codeClass }, { t: '!,\n', c: C.codeText },
  { t: '  })],\n})\n\n', c: C.codeText },
  { t: 'const', c: C.codeKeyword }, { t: ' res ', c: C.codeText },
  { t: '= ', c: C.codeDim }, { t: 'await', c: C.codeKeyword },
  { t: ' mppx', c: C.codeText }, { t: '.', c: C.codeDim },
  { t: 'fetch', c: C.codeKeyword }, { t: '(', c: C.codeText },
  { t: "'https://example.com/hello'", c: C.codeString }, { t: ')\n\n', c: C.codeText },
  { t: '// → GET /hello\n', c: C.codeComment },
  { t: '// ← 402  lnbc100n1p3xkyk...\n', c: C.accent },
  { t: '//   ⚡ paying via Spark...\n', c: C.codeDim },
  { t: '// ← 200 OK  { text: "world" }', c: C.codeOk },
]

export function Landing() {
  const navigate = useNavigate()
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 768
  const [hov, setHov] = useState(false)

  return (
    <div style={{
      fontFamily: M, background: C.bg, color: C.text,
      height: isMobile ? undefined : '100dvh',
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      overflowX: 'hidden', overflowY: isMobile ? 'auto' : 'hidden',
      position: 'relative',
    }}>
      {/* Subtle grid — desktop only */}
      {!isMobile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: '48px 48px', opacity: 0.6,
          maskImage: 'radial-gradient(ellipse 70% 90% at 70% 45%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 90% at 70% 45%, black 0%, transparent 75%)',
        }} />
      )}

      {/* Nav */}
      <nav style={{
        position: 'relative', zIndex: 1,
        padding: isMobile ? '16px 20px' : '18px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      }}>
        <div style={{ display: 'flex', gap: isMobile ? 16 : 28, alignItems: 'center' }}>
          {([
            ['mpp.dev ↗', 'https://mpp.dev/'],
            ['spec ↗', 'https://paymentauth.org'],
            ['github ↗', 'https://github.com/buildonspark/lightning-mpp-sdk'],
          ] as [string, string][]).map(([label, href]) => (
            <a
              key={label} href={href} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: isMobile ? 11 : 12, color: '#888888', textDecoration: 'none', letterSpacing: '0.02em', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = C.text)}
              onMouseLeave={e => (e.currentTarget.style.color = '#888888')}
            >{label}</a>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <div style={{
        position: 'relative', zIndex: 1, flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? '36px 20px 0' : '0 48px',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? 0 : 48,
          width: '100%',
          maxWidth: 1100,
        }}>
          {/* Left */}
          <div style={{ flex: isMobile ? 'none' : 1, maxWidth: isMobile ? '100%' : 500 }}>
            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: `1px solid ${C.border}`, borderRadius: 100,
              padding: '4px 14px 4px 10px', marginBottom: isMobile ? 20 : 28,
              fontSize: 11, color: C.textDim, letterSpacing: '0.04em',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: C.accent, display: 'inline-block', flexShrink: 0,
              }} />
              HTTP 402 Payment Required
            </div>

            {/* Headline */}
            <h1 style={{
              fontSize: isMobile ? '36px' : 'clamp(32px, 4vw, 52px)',
              fontWeight: 700, lineHeight: 1.05,
              letterSpacing: '-0.02em', marginBottom: 6, color: C.text,
              fontFamily: M,
            }}>
              lightning-mpp
            </h1>
            <div style={{
              fontSize: isMobile ? '16px' : 'clamp(16px, 1.8vw, 22px)',
              fontWeight: 400, lineHeight: 1.3,
              letterSpacing: '-0.01em', marginBottom: isMobile ? 20 : 24,
              color: C.textDim,
            }}>
              HTTP payments for APIs.
            </div>

            {/* Tagline */}
            <p style={{
              fontSize: 13, lineHeight: 1.75,
              color: C.textDim, marginBottom: isMobile ? 24 : 32, maxWidth: 400,
            }}>
              Charge for API calls with Lightning — no accounts,<br />no API keys, no subscriptions.
            </p>

            {/* Flow steps */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: isMobile ? 28 : 36 }}>
              {([
                { icon: '→', label: 'Request', c: '#AAAAAA' },
                { icon: '⚡', label: '402', c: C.accent },
                { icon: '₿', label: 'Pay', c: '#AAAAAA' },
                { icon: '✓', label: 'Access', c: C.text },
              ] as { icon: string; label: string; c: string }[]).map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    textAlign: 'center', padding: '7px 12px',
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
                  }}>
                    <div style={{ fontSize: 13, color: step.c, marginBottom: 3, lineHeight: 1 }}>{step.icon}</div>
                    <div style={{ fontSize: 9, color: '#555555', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{step.label}</div>
                  </div>
                  {i < 3 && <div style={{ width: 14, height: 1, background: C.borderHi, flexShrink: 0 }} />}
                </div>
              ))}
            </div>

            {/* CTA */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: isMobile ? 32 : 0 }}>
              <button
                style={{
                  background: hov ? '#FFAC1C' : C.accent,
                  color: '#000', border: 'none',
                  padding: isMobile ? '13px 22px' : '12px 24px',
                  fontFamily: M, fontSize: isMobile ? 14 : 13,
                  fontWeight: 700, letterSpacing: '0.01em', cursor: 'pointer',
                  borderRadius: 5, display: 'flex', alignItems: 'center', gap: 8,
                  transform: hov ? 'translateY(-1px)' : 'translateY(0)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={() => setHov(true)}
                onMouseLeave={() => setHov(false)}
                onClick={() => navigate('/playground')}
              >
                Open Playground
                <span style={{
                  fontSize: 15, display: 'inline-block',
                  transform: hov ? 'translateX(2px)' : 'translateX(0)',
                  transition: 'transform 0.15s',
                }}>→</span>
              </button>
            </div>
          </div>

          {/* Right: Code preview */}
          <div style={{
            flex: isMobile ? 'none' : 1,
            maxWidth: isMobile ? '100%' : 560,
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: isMobile ? '8px 8px 0 0' : 8,
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{
              padding: '11px 16px', background: C.surfaceHi,
              borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: C.borderHi }} />
                ))}
              </div>
              <span style={{ fontSize: 11, color: C.textDim }}>lightning-mpp.ts</span>
            </div>

            <pre style={{
              fontFamily: M, fontSize: isMobile ? 11.5 : 12, lineHeight: 1.75,
              padding: isMobile ? '16px 18px 20px' : '20px 24px 28px', margin: 0,
              overflow: 'auto', whiteSpace: 'pre',
            }}>
              {CODE_TOKENS.map((tok, i) => (
                <span key={i} style={{ color: tok.c }}>{tok.t}</span>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
