import { VerificarCurpError } from './errors.js'
import type { WebhookEnvelope } from './types.js'

/** Header con `sha256=<hex>`. */
export const SIGNATURE_HEADER = 'X-Signature'
/** Header con los segundos Unix que cubre la firma. */
export const SIGNATURE_TIMESTAMP_HEADER = 'X-Signature-Timestamp'
/** Header con la clave de idempotencia de la entrega. */
export const IDEMPOTENCY_KEY_HEADER = 'X-Idempotency-Key'

const DEFAULT_TOLERANCE_S = 300

export interface VerifyWebhookInput {
  /** El secreto del destino (`whsec_…`), mostrado una vez al crearlo. */
  secret: string
  /** El cuerpo CRUDO, exactamente como llegó. No lo re-serialices. */
  rawBody: string | Uint8Array
  /** Valor del header `X-Signature`. */
  signature: string | null | undefined
  /** Valor del header `X-Signature-Timestamp`. */
  timestamp: string | null | undefined
  /**
   * Antigüedad máxima aceptada, en segundos (por defecto 300). Protege contra
   * la repetición de una entrega capturada. `0` desactiva la comprobación.
   */
  toleranceSeconds?: number
  /** Solo para pruebas: segundos Unix "actuales". */
  now?: number
}

/**
 * Comprueba que una entrega a tu webhook viene de Verificar CURP.
 *
 * La firma es `sha256=` + HMAC-SHA256(secreto, `timestamp + "." + cuerpo`).
 * Devuelve false (nunca lanza) ante una firma ausente, malformada, incorrecta
 * o fuera de tiempo.
 */
export async function verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean> {
  const { secret, signature, timestamp } = input
  if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false

  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_S
  if (tolerance > 0) {
    const now = input.now ?? Math.floor(Date.now() / 1000)
    if (Math.abs(now - Number(timestamp)) > tolerance) return false
  }

  const body =
    typeof input.rawBody === 'string' ? input.rawBody : new TextDecoder().decode(input.rawBody)
  const expected = 'sha256=' + (await hmacSha256Hex(secret, `${timestamp}.${body}`))
  return constantTimeEqual(expected, signature)
}

/**
 * Verifica la firma y devuelve el cuerpo ya interpretado.
 *
 * @throws {VerificarCurpError} `INVALID_SIGNATURE` si la firma no es válida.
 *
 * @example
 * // Express: usa express.raw({ type: 'application/json' }) en esta ruta.
 * const event = await parseWebhook({
 *   secret: process.env.CURP_WEBHOOK_SECRET!,
 *   rawBody: req.body,
 *   signature: req.get('X-Signature'),
 *   timestamp: req.get('X-Signature-Timestamp'),
 * })
 * if (event.event === 'curp.verification.completed') console.log(event.data.estatus)
 */
export async function parseWebhook(input: VerifyWebhookInput): Promise<WebhookEnvelope> {
  if (!(await verifyWebhookSignature(input))) {
    throw new VerificarCurpError('Firma de webhook inválida o vencida.', 'INVALID_SIGNATURE')
  }
  const body =
    typeof input.rawBody === 'string' ? input.rawBody : new TextDecoder().decode(input.rawBody)
  try {
    return JSON.parse(body) as WebhookEnvelope
  } catch (err) {
    throw new VerificarCurpError('El cuerpo del webhook no es JSON.', 'INVALID_INPUT', { cause: err })
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const subtle = await getSubtle()
  const key = await subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Web Crypto: global en Node 19+, Deno, Bun, Workers; en Node 18 viene de node:crypto. */
async function getSubtle(): Promise<SubtleCrypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle
  const { webcrypto } = await import('node:crypto')
  return webcrypto.subtle as SubtleCrypto
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
