/**
 * SDK oficial de Verificar CURP: valida, coteja y verifica CURPs en RENAPO.
 *
 * @see https://verificarcurp.com/docs
 * @packageDocumentation
 */
export { VerificarCurpClient } from './client.js'
export { VerificarCurpError } from './errors.js'
export type { CurpErrorCode } from './errors.js'
export {
  verifyWebhookSignature,
  parseWebhook,
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  IDEMPOTENCY_KEY_HEADER,
} from './webhooks.js'
export type { VerifyWebhookInput } from './webhooks.js'
export type * from './types.js'
