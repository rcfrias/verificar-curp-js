import { VerificarCurpError } from './errors.js'
import type {
  CaptureLink,
  CreateCaptureLinkInput,
  ValidateInput,
  ValidateResult,
  VerificarCurpOptions,
  VerificationStatusResult,
} from './types.js'

const DEFAULT_BASE_URL = 'https://verificarcurp.com/api/v1'
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Cliente para la API de Verificar CURP.
 *
 * @example
 * import { VerificarCurpClient } from 'verificar-curp'
 *
 * const client = new VerificarCurpClient({ apiKey: process.env.CURP_API_KEY! })
 * const { data } = await client.validate({
 *   curp: 'PEGJ850101HDFRRL04',
 *   persona: { nombres: 'Julio', fechaNacimiento: '1985-01-01' },
 * })
 * console.log(data.valida, data.cotejo)
 *
 * @see https://verificarcurp.com/docs
 */
export class VerificarCurpClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: VerificarCurpOptions) {
    if (!options || !options.apiKey) {
      throw new VerificarCurpError('Falta `apiKey` en las opciones del cliente.', 'INVALID_INPUT')
    }
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new VerificarCurpError(
        'No hay `fetch` disponible. Usa Node 18+ o pasa `fetch` en las opciones.',
        'INVALID_INPUT'
      )
    }
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = fetchImpl
  }

  /**
   * Valida la estructura de una CURP y, si mandas `persona`, la coteja con
   * esos datos. Con `verificar: true` la verifica además en el registro
   * RENAPO: la respuesta trae `verificacion` al instante y el resultado del
   * registro llega a tu `destinationId` por separado.
   *
   * Una CURP mal formada NO es un error: responde `data.valida === false` con
   * el motivo en `data.razon`.
   *
   * @throws {VerificarCurpError} ante saldo insuficiente, destino inexistente,
   *   petición inválida, error de red, timeout, etc. Revisa `error.code`.
   */
  async validate(input: ValidateInput): Promise<ValidateResult> {
    if (!input || typeof input.curp !== 'string' || input.curp.trim() === '') {
      throw new VerificarCurpError('Falta la CURP (`curp`).', 'INVALID_INPUT')
    }
    if (input.verificar && !input.destinationId) {
      throw new VerificarCurpError(
        '`destinationId` es obligatorio con `verificar: true`.',
        'INVALID_INPUT'
      )
    }

    const body = (await this.request('/curp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })) as {
      data: ValidateResult['data']
      tokens_remaining: number
      verificacion?: ValidateResult['verificacion']
    }

    return {
      data: body.data,
      tokensRemaining: body.tokens_remaining,
      ...(body.verificacion ? { verificacion: body.verificacion } : {}),
    }
  }

  /**
   * Consulta el estado de una verificación (sin costo).
   *
   * Si el resultado del registro sigue guardado, llega en `valores` UNA sola
   * vez y se borra en la misma operación. Si tu destino ya lo recibió, aquí
   * solo verás el estado: esta consulta es la forma de recuperarlo cuando la
   * entrega a tu destino falló.
   *
   * @throws {VerificarCurpError} `NOT_FOUND` si la verificación no es de tu cuenta.
   */
  async getVerification(jobId: string): Promise<VerificationStatusResult> {
    if (!jobId) {
      throw new VerificarCurpError('Falta el `jobId`.', 'INVALID_INPUT')
    }
    const body = (await this.request(`/curp/verificacion/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    })) as VerificationStatusResult
    return {
      verificacion: body.verificacion,
      ...(body.valores ? { valores: body.valores } : {}),
    }
  }

  /** Consulta el saldo de tokens de tu cuenta. */
  async getBalance(): Promise<number> {
    const body = await this.request('/balance', { method: 'GET' })
    return Number((body as { balance: number }).balance)
  }

  /**
   * Crea un enlace de un solo uso para que tu cliente escriba su CURP desde su
   * celular. Crearlo no cuesta; cada respuesta del cliente cuesta 1 token (hasta
   * 3 intentos) y solo una CURP válida que coincide llega a `destinationId`.
   *
   * @throws {VerificarCurpError} `DESTINATION_NOT_FOUND`, `INVALID_PERSONA`,
   *   `TOO_MANY_LIVE_LINKS`, etc. Revisa `error.code`.
   */
  async createCaptureLink(input: CreateCaptureLinkInput): Promise<CaptureLink> {
    if (!input || !input.destinationId) {
      throw new VerificarCurpError('Falta `destinationId`.', 'INVALID_INPUT')
    }
    const payload: Record<string, unknown> = { destinationId: input.destinationId }
    if (input.persona !== undefined) payload.persona = input.persona
    if (input.askGuestPersona) payload.askGuestPersona = true
    if (input.reference !== undefined) payload.reference = input.reference
    if (input.requesterName !== undefined) payload.requesterName = input.requesterName
    if (input.name !== undefined) payload.name = input.name

    const body = (await this.request('/capture-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })) as CaptureLink
    return {
      id: body.id,
      url: body.url,
      reference: body.reference ?? null,
      askGuestPersona: body.askGuestPersona,
      expiresAt: body.expiresAt,
    }
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let res: Response
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        signal: controller.signal,
        headers: { 'X-API-Key': this.apiKey, ...((init.headers as Record<string, string>) ?? {}) },
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new VerificarCurpError(
          `La petición excedió el timeout de ${this.timeoutMs} ms.`,
          'TIMEOUT',
          { cause: err }
        )
      }
      throw new VerificarCurpError(err instanceof Error ? err.message : 'Error de red', 'NETWORK_ERROR', {
        cause: err,
      })
    } finally {
      clearTimeout(timer)
    }

    const body = await res.json().catch(() => ({}))
    if (!res.ok || (body as { success?: boolean })?.success === false) {
      throw VerificarCurpError.fromResponse(res.status, body)
    }
    return body
  }
}
