import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  VerificarCurpClient,
  VerificarCurpError,
  verifyWebhookSignature,
  parseWebhook,
} from '../dist/index.js'

function fakeFetch(response) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return response
  }
  fn.calls = calls
  return fn
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ANSWER = {
  curp: 'PEGJ850101HDFRRL04',
  valida: true,
  razon: null,
  fechaNacimiento: '1985-01-01',
  sexo: 'H',
  claveEntidad: 'DF',
  entidad: 'Ciudad de México',
  cotejo: 'coincide',
  cotejoCampos: { nombres: 'coincide' },
}

test('constructor requires an apiKey', () => {
  assert.throws(() => new VerificarCurpClient({}), VerificarCurpError)
})

test('validate posts JSON with the API key and maps the response', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { success: true, data: ANSWER, tokens_remaining: 9 }))
  const client = new VerificarCurpClient({ apiKey: 'curp_test', fetch: fetchImpl })

  const input = { curp: 'PEGJ850101HDFRRL04', persona: { nombres: 'Julio', segundoApellido: null } }
  const result = await client.validate(input)
  assert.deepEqual(result, { data: ANSWER, tokensRemaining: 9 })

  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, 'https://verificarcurp.com/api/v1/curp')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['X-API-Key'], 'curp_test')
  assert.equal(init.headers['Content-Type'], 'application/json')
  // null segundoApellido must survive: it means "has none", not "don't compare".
  assert.deepEqual(JSON.parse(init.body), input)
})

test('validate passes verificacion through, accepted or declined', async () => {
  const verificacion = { aceptada: false, codigo: 'REGISTRY_UNAVAILABLE', retry_after: 60 }
  const fetchImpl = fakeFetch(
    jsonResponse(200, { success: true, data: ANSWER, tokens_remaining: 9, verificacion })
  )
  const client = new VerificarCurpClient({ apiKey: 'k', fetch: fetchImpl })
  const result = await client.validate({ curp: ANSWER.curp, verificar: true, destinationId: 'dst_1' })
  assert.deepEqual(result.verificacion, verificacion)
})

test('validate refuses verificar without destinationId before calling the API', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, {}))
  const client = new VerificarCurpClient({ apiKey: 'k', fetch: fetchImpl })
  await assert.rejects(client.validate({ curp: ANSWER.curp, verificar: true }), {
    code: 'INVALID_INPUT',
  })
  await assert.rejects(client.validate({ curp: '  ' }), { code: 'INVALID_INPUT' })
  assert.equal(fetchImpl.calls.length, 0)
})

test('API errors become VerificarCurpError with code, status and block reason', async () => {
  const fetchImpl = fakeFetch(
    jsonResponse(402, {
      success: false,
      error: 'Saldo insuficiente',
      code: 'INSUFFICIENT_TOKENS',
      block_reason: 'auto_topup_failed',
    })
  )
  const client = new VerificarCurpClient({ apiKey: 'k', fetch: fetchImpl })
  await assert.rejects(client.validate({ curp: ANSWER.curp }), (err) => {
    assert.ok(err instanceof VerificarCurpError)
    assert.equal(err.code, 'INSUFFICIENT_TOKENS')
    assert.equal(err.status, 402)
    assert.equal(err.blockReason, 'auto_topup_failed')
    assert.equal(err.message, 'Saldo insuficiente')
    return true
  })
})

test('getVerification encodes the job id and returns valores when present', async () => {
  const verificacion = { job_id: 'clz 1', estado: 'delivered', valores_entregados: true }
  const valores = { estatus: 'ACTIVA', curp: ANSWER.curp }
  const fetchImpl = fakeFetch(jsonResponse(200, { success: true, verificacion, valores }))
  const client = new VerificarCurpClient({ apiKey: 'k', fetch: fetchImpl })

  const result = await client.getVerification('clz 1')
  assert.deepEqual(result, { verificacion, valores })
  assert.equal(fetchImpl.calls[0].url, 'https://verificarcurp.com/api/v1/curp/verificacion/clz%201')
  assert.equal(fetchImpl.calls[0].init.method, 'GET')
})

test('getBalance returns the number', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { success: true, balance: 42 }))
  const client = new VerificarCurpClient({ apiKey: 'k', fetch: fetchImpl, baseUrl: 'http://x/api/v1/' })
  assert.equal(await client.getBalance(), 42)
  assert.equal(fetchImpl.calls[0].url, 'http://x/api/v1/balance')
})

test('network failure and timeout map to SDK codes', async () => {
  const failing = async () => {
    throw new TypeError('fetch failed')
  }
  const c1 = new VerificarCurpClient({ apiKey: 'k', fetch: failing })
  await assert.rejects(c1.getBalance(), { code: 'NETWORK_ERROR' })

  const hanging = (_url, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    )
  const c2 = new VerificarCurpClient({ apiKey: 'k', fetch: hanging, timeoutMs: 10 })
  await assert.rejects(c2.getBalance(), { code: 'TIMEOUT' })
})

// --- webhooks ------------------------------------------------------------

const SECRET = 'whsec_' + 'ab'.repeat(32)
const RAW = JSON.stringify({ version: '1', event: 'curp.verification.completed', data: { estatus: 'ACTIVA' } })

/** Exactly what the server's signPayload() computes. */
function serverSign(secret, timestamp, rawBody) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

test('verifyWebhookSignature accepts what the server signs', async () => {
  const ts = '1790000000'
  const signature = serverSign(SECRET, ts, RAW)
  assert.equal(await verifyWebhookSignature({ secret: SECRET, rawBody: RAW, signature, timestamp: ts, now: 1790000010 }), true)
  // Raw bytes work the same as a string.
  const bytes = new TextEncoder().encode(RAW)
  assert.equal(await verifyWebhookSignature({ secret: SECRET, rawBody: bytes, signature, timestamp: ts, now: 1790000010 }), true)
})

test('verifyWebhookSignature rejects tampering, wrong secret, stale or missing headers', async () => {
  const ts = '1790000000'
  const signature = serverSign(SECRET, ts, RAW)
  const base = { secret: SECRET, rawBody: RAW, signature, timestamp: ts, now: 1790000000 }
  assert.equal(await verifyWebhookSignature({ ...base, rawBody: RAW.replace('ACTIVA', 'BAJA') }), false)
  assert.equal(await verifyWebhookSignature({ ...base, secret: 'whsec_other' }), false)
  assert.equal(await verifyWebhookSignature({ ...base, timestamp: '1790000001' }), false)
  assert.equal(await verifyWebhookSignature({ ...base, now: 1790000301 }), false)
  assert.equal(await verifyWebhookSignature({ ...base, now: 1790000301, toleranceSeconds: 0 }), true)
  assert.equal(await verifyWebhookSignature({ ...base, signature: undefined }), false)
  assert.equal(await verifyWebhookSignature({ ...base, signature: 'sha256=zz' }), false)
  assert.equal(await verifyWebhookSignature({ ...base, timestamp: 'abc' }), false)
})

test('parseWebhook returns the envelope or throws INVALID_SIGNATURE', async () => {
  const ts = String(Math.floor(Date.now() / 1000))
  const signature = serverSign(SECRET, ts, RAW)
  const event = await parseWebhook({ secret: SECRET, rawBody: RAW, signature, timestamp: ts })
  assert.equal(event.data.estatus, 'ACTIVA')
  await assert.rejects(parseWebhook({ secret: 'whsec_x', rawBody: RAW, signature, timestamp: ts }), {
    code: 'INVALID_SIGNATURE',
  })
})
