import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'

async function load(source) {
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
}
const root = new URL('../supabase/functions/_shared/', import.meta.url)
const { assertSandboxEnvironment } = await load(readFileSync(new URL('sandbox.ts', root), 'utf8'))
const good = { SUPABASE_URL: 'https://yhlaynvgmvfxvwhvlboq.supabase.co', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture' }
assert.doesNotThrow(() => assertSandboxEnvironment(k => good[k]))
for (const changes of [{ SUPABASE_URL: 'https://production.example' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' }, { STRIPE_SECRET_KEY: undefined }]) {
  assert.throws(() => assertSandboxEnvironment(k => ({ ...good, ...changes })[k]))
}
// Isolate the pure verifier without loading the Deno remote Supabase dependency.
const shared = readFileSync(new URL('billing.ts', root), 'utf8')
const { verifyStripeSignature } = await load(shared.slice(shared.indexOf('export async function verifyStripeSignature')))
const now = Date.now(), t = Math.floor(now / 1000), raw = '{"id":"evt_fixture"}', secret = 'whsec_fixture'
const signature = (payload, time = t) => `t=${time},v1=${createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex')}`
assert.equal(await verifyStripeSignature(raw, signature(raw), secret, now), true)
assert.equal(await verifyStripeSignature(raw + ' ', signature(raw), secret, now), false)
assert.equal(await verifyStripeSignature(raw, signature(raw, t - 301), secret, now), false)
assert.equal(await verifyStripeSignature(raw, signature(raw), 'wrong', now), false)
assert.equal(await verifyStripeSignature(raw, 't=invalid,v1=bad', secret, now), false)
assert.equal(await verifyStripeSignature(raw, `${signature(raw)},v1=${'0'.repeat(64)}`, secret, now), true)
console.log('Passed: sandbox restrictions and signed webhook validation (11 checks).')
