import { charge as charge_ } from './Charge.js'
import { session as session_ } from './Session.js'

/**
 * Creates `spark` Lightning methods for usage on the server.
 *
 * @example
 * ```ts
 * import { Mppx, spark } from 'spark-mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [spark.charge({ mnemonic: process.env.MNEMONIC! })],
 * })
 * ```
 */
export function spark(parameters: spark.Parameters): ReturnType<typeof charge_> {
  return spark.charge(parameters)
}

export namespace spark {
  export type Parameters = charge_.Parameters

  /** Creates a Lightning `charge` method for BOLT11 invoice payments. */
  export const charge = charge_

  /** Creates a Lightning `session` method for prepaid metered-access payments. */
  export const session = session_
}
