import { memo } from 'react'

type Token = { text: string; color: string }

function tokenize(line: string): Token[] {
  const TOKEN_RE = new RegExp(
    [
      /('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/.source,     // strings
      /\b(import|from|const|await|async|return)\b/.source, // keywords
      /\b([A-Z][a-zA-Z0-9]*)\b/.source,                   // class names
      /\b([a-z][a-zA-Z0-9]*)(?=\s*\()/.source,            // method calls
    ].join('|'),
    'g',
  )
  const tokens: Token[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > last) tokens.push({ text: line.slice(last, match.index), color: '#c8c8c8' })
    if (match[1])      tokens.push({ text: match[1], color: '#ffb300' }) // string
    else if (match[2]) tokens.push({ text: match[2], color: '#00e5ff' }) // keyword
    else if (match[3]) tokens.push({ text: match[3], color: '#39ff14' }) // class
    else if (match[4]) tokens.push({ text: match[4], color: '#c8c8c8' }) // method call
    last = match.index + match[0].length
  }
  if (last < line.length) tokens.push({ text: line.slice(last), color: '#c8c8c8' })
  return tokens
}

export const CodeBlock = memo(function CodeBlock({ code }: { code: string }) {
  return (
    <>
      {code.split('\n').map((line, i) =>
        line.trim() === ''
          ? <div key={i} style={{ minHeight: '1.7em' }}> </div>
          : (
            <div key={i} style={{ minHeight: '1.7em' }}>
              {tokenize(line).map((tok, j) => (
                <span key={j} style={{ color: tok.color }}>{tok.text}</span>
              ))}
            </div>
          )
      )}
    </>
  )
})
