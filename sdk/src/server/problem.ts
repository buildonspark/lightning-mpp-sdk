/**
 * RFC 9457 Problem Details for HTTP APIs.
 * https://www.rfc-editor.org/rfc/rfc9457
 */

export interface ProblemDetails {
  /** A URI reference that identifies the problem type. */
  type: string
  /** A short, human-readable summary of the problem type. */
  title: string
  /** The HTTP status code for this occurrence of the problem. */
  status: number
  /** A human-readable explanation specific to this occurrence. */
  detail: string
}

/**
 * An error that carries RFC 9457 Problem Details fields.
 * Throw this inside verify() handlers to produce structured error responses.
 */
export class ProblemDetailsError extends Error implements ProblemDetails {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string

  constructor(problem: ProblemDetails) {
    super(problem.detail)
    this.name = 'ProblemDetailsError'
    this.type = problem.type
    this.title = problem.title
    this.status = problem.status
    this.detail = problem.detail
  }
}

/**
 * Converts a ProblemDetailsError (or any Error) into an RFC 9457 compliant
 * HTTP Response with Content-Type: application/problem+json.
 */
export function toProblemResponse(err: unknown): Response {
  if (err instanceof ProblemDetailsError) {
    return new Response(
      JSON.stringify({
        type: err.type,
        title: err.title,
        status: err.status,
        detail: err.detail,
      }),
      {
        status: err.status,
        headers: { 'Content-Type': 'application/problem+json' },
      },
    )
  }
  const detail = err instanceof Error ? err.message : String(err)
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail,
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  )
}

/** Problem type URI namespace for this SDK. */
export const ProblemType = {
  InvalidPreimage:      'https://mppx.dev/problems/invalid-preimage',
  InvoiceExpired:       'https://mppx.dev/problems/invoice-expired',
  PreimageConsumed:     'https://mppx.dev/problems/preimage-consumed',
  DepositConsumed:      'https://mppx.dev/problems/deposit-consumed',
  InsufficientDeposit:  'https://mppx.dev/problems/insufficient-deposit',
  InvalidReturnInvoice: 'https://mppx.dev/problems/invalid-return-invoice',
  SessionNotFound:      'https://mppx.dev/problems/session-not-found',
  SessionClosed:        'https://mppx.dev/problems/session-closed',
  UnknownAction:        'https://mppx.dev/problems/unknown-action',
} as const
