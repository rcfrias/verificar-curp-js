/**
 * Códigos de error de la API de Verificar CURP, más los propios del SDK
 * (`NETWORK_ERROR`, `TIMEOUT`, `INVALID_INPUT`, `INVALID_SIGNATURE`).
 *
 * @see https://verificarcurp.com/docs
 */
export type CurpErrorCode =
  // 400
  | 'INVALID_REQUEST'
  | 'DESTINATION_NOT_FOUND'
  // 401
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  // 402
  | 'INSUFFICIENT_TOKENS'
  // 404
  | 'NOT_FOUND'
  // 409
  | 'IDEMPOTENCY_KEY_REUSED'
  // 500
  | 'INTERNAL_ERROR'
  // SDK-only
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_INPUT'
  | 'INVALID_SIGNATURE'
  // forward-compatible: unknown server codes
  | (string & {})

/**
 * Error lanzado por el SDK ante una respuesta no exitosa de la API, un fallo
 * de red o timeout, o una firma de webhook inválida. Revisa `code`.
 *
 * @example
 * try {
 *   await client.validate({ curp })
 * } catch (err) {
 *   if (err instanceof VerificarCurpError && err.code === 'INSUFFICIENT_TOKENS') {
 *     // recarga tokens
 *   }
 * }
 */
export class VerificarCurpError extends Error {
  /** Código de error legible por máquina. */
  readonly code: CurpErrorCode
  /** Status HTTP de la respuesta (ausente en errores de red). */
  readonly status?: number
  /** Motivo de bloqueo (algunos INSUFFICIENT_TOKENS). */
  readonly blockReason?: string
  /** Cuerpo crudo de la respuesta de error. */
  readonly response?: unknown

  constructor(
    message: string,
    code: CurpErrorCode,
    init: { status?: number; blockReason?: string; response?: unknown; cause?: unknown } = {}
  ) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'VerificarCurpError'
    this.code = code
    this.status = init.status
    this.blockReason = init.blockReason
    this.response = init.response
    Object.setPrototypeOf(this, VerificarCurpError.prototype)
  }

  /** Construye el error a partir de una respuesta de la API. */
  static fromResponse(status: number, body: unknown): VerificarCurpError {
    const b = (body ?? {}) as Record<string, unknown>
    const code = (typeof b.code === 'string' ? b.code : 'INTERNAL_ERROR') as CurpErrorCode
    const message = (typeof b.error === 'string' && b.error) || `La API respondió con status ${status}`
    return new VerificarCurpError(message, code, {
      status,
      blockReason: typeof b.block_reason === 'string' ? b.block_reason : undefined,
      response: body,
    })
  }
}
