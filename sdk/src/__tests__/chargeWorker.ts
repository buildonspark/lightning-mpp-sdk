/** Child process used to test replay prevention with shared, atomic storage */
import { readFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { mock } from 'node:test'
import { SparkWallet } from '@buildonspark/spark-sdk'
import { Mppx } from 'mppx/server'
import { charge } from '../server/Charge.js'

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  directory: string
  authorization: string
  secretKey: string
}

mock.method(SparkWallet, 'initialize', async () => {
  throw new Error('The paid retry must not initialize a wallet')
})

const mppx = Mppx.create({
  methods: [charge({
    mnemonic: 'unused-test-mnemonic',
    async consumePayment(paymentHash) {
      // Exclusive creation is atomic across independent OS processes. The
      // marker survives this worker exiting; the parent owns its cleanup
      let marker
      try {
        marker = await open(join(input.directory, paymentHash), 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
      try {
        await marker.sync()
        return true
      } finally {
        await marker.close()
      }
    },
  })],
  secretKey: input.secretKey,
  realm: 'payments.test',
})

const result = await mppx.charge({ amount: '1' })(new Request('https://payments.test/resource', {
  headers: { Authorization: input.authorization },
}))
process.stdout.write(String(result.status))
