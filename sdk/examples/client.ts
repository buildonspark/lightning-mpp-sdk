/**
 * Example: MPP weather client using the Spark Lightning payment method.
 *
 * Run with: npm run example:client
 */
import { Mppx, spark } from '../src/client/index.js'

const CLIENT_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const method = spark.charge({ mnemonic: CLIENT_MNEMONIC, network: 'regtest' })

const mppx = Mppx.create({
  polyfill: false,
  methods: [method],
})

try {
  console.log('→ GET http://localhost:3000/weather')
  const response = await mppx.fetch('http://localhost:3000/weather')

  if (!response.ok) {
    console.error(`✗ ${response.status} ${response.statusText}`)
    console.error(await response.text())
    process.exit(1)
  }

  console.log(`✓ ${response.status} — payment accepted`)

  const receipt = response.headers.get('Payment-Receipt')
  if (receipt) {
    const decoded = JSON.parse(atob(receipt.replace(/-/g, '+').replace(/_/g, '/')))
    console.log(`  method:    ${decoded.method}`)
    console.log(`  reference: ${decoded.reference}`)
    console.log(`  timestamp: ${decoded.timestamp}`)
  }

  const weather = await response.json()
  console.log('\nWeather report:')
  console.log(JSON.stringify(weather, null, 2))
} finally {
  await method.cleanup()
}
