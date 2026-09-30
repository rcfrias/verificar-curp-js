/**
 * Tipos de la API de Verificar CURP. Los nombres de campo son los mismos que
 * en la API y en https://verificarcurp.com/docs, para que la documentación y
 * el código se lean igual.
 */

export interface VerificarCurpOptions {
  /** Tu API key (panel → API Keys). */
  apiKey: string
  /** Por defecto `https://verificarcurp.com/api/v1`. */
  baseUrl?: string
  /** Timeout por petición, en milisegundos. Por defecto 30 000. */
  timeoutMs?: number
  /** Implementación de `fetch` a usar. Por defecto la global (Node 18+). */
  fetch?: typeof fetch
}

/**
 * Lo que ya sabes de la persona. Todo es opcional y solo se compara lo que
 * mandas. `segundoApellido: null` significa "no tiene segundo apellido" (y se
 * compara); omitirlo significa "no comparar".
 */
export interface Persona {
  nombres?: string
  primerApellido?: string
  segundoApellido?: string | null
  /** AAAA-MM-DD */
  fechaNacimiento?: string
  /** H o M. */
  sexo?: string
  /** Nombre o clave de la entidad de nacimiento. */
  entidad?: string
}

/** Cambia, solo para esta petición, los reintentos automáticos de la verificación. */
export interface Reintentos {
  /** Con false no hay reintentos automáticos; pasa directo a revisión manual. */
  activo?: boolean
  /** Intentos en total. */
  max?: number
  /** Segundos antes del primer reintento (la espera se duplica en cada intento). */
  espera_s?: number
}

export interface ValidateInput {
  curp: string
  /** Coteja la CURP contra estos datos. */
  persona?: Persona
  /** Verifica además en el registro RENAPO; el resultado llega a `destinationId`. */
  verificar?: boolean
  /** Obligatorio con `verificar`: el destino (webhook, correo o chat) del panel. */
  destinationId?: string
  /** Etiqueta tuya, devuelta en la entrega. Nunca pongas la CURP aquí. */
  idempotencyKey?: string
  reintentos?: Reintentos
}

export type CurpInvalidReason =
  | { kind: 'length'; length: number }
  | {
      kind: 'shape'
      part:
        | 'initials'
        | 'birth-date'
        | 'sex'
        | 'entidad'
        | 'consonants'
        | 'differentiator'
        | 'check-digit'
      positions: [number, number]
    }
  | { kind: 'entidad'; code: string }
  | { kind: 'birth-date'; year: number; month: number; day: number }
  | { kind: 'check-digit'; expected: string; actual: string }

export type CotejoVerdict = 'coincide' | 'no_coincide' | 'indeterminado'

export interface CurpAnswer {
  curp: string
  valida: boolean
  razon: CurpInvalidReason | null
  fechaNacimiento: string | null
  sexo: 'H' | 'M' | null
  claveEntidad: string | null
  entidad: string | null
  cotejo: CotejoVerdict | null
  cotejoCampos: Partial<
    Record<
      'nombres' | 'primerApellido' | 'segundoApellido' | 'fechaNacimiento' | 'sexo' | 'entidad',
      CotejoVerdict
    >
  > | null
}

export interface VerificationAccepted {
  aceptada: true
  job_id: string
  estado: string
  expires_at: string
  repetida?: boolean
  reintentos?: Reintentos
}

export interface VerificationDeclined {
  aceptada: false
  codigo: 'REGISTRY_UNAVAILABLE' | 'REGISTRY_CEILING_REACHED' | 'TOO_MANY_VERIFICATIONS' | (string & {})
  /** Segundos sugeridos antes de volver a intentar, o null. */
  retry_after: number | null
}

export interface ValidateResult {
  data: CurpAnswer
  tokensRemaining: number
  /** Solo cuando pediste `verificar`. */
  verificacion?: VerificationAccepted | VerificationDeclined
}

export type RegistryStatus = 'ACTIVA' | 'BAJA' | 'RNE' | 'NO_ENCONTRADA'

export interface RegistryValues {
  estatus: RegistryStatus | (string & {})
  curp: string
  nombres?: string
  primerApellido?: string
  segundoApellido?: string
  sexo?: string
  fechaNacimiento?: string
  entidadNacimiento?: string
  nacionalidad?: string
  documentoProbatorio?: string
}

export type VerificationState =
  | 'pending'
  | 'running'
  | 'retry-wait'
  | 'needs-human'
  | 'delivered'
  | 'failed'
  | 'expired'

export interface VerificationStatus {
  job_id: string
  estado: VerificationState | (string & {})
  codigo: string | null
  duracion_ms: number | null
  creado_en: string
  expira_en: string
  terminado_en: string | null
  destino_id: string | null
  entrega_ok: boolean | null
  entrega_ms: number | null
  cobrado: boolean
  intentos: number
  max_intentos: number | null
  proximo_intento_en: string | null
  reintentos_hasta: string | null
  ultimo_codigo: string | null
  revision_manual: string | null
  valores_entregados: boolean
}

export interface VerificationStatusResult {
  verificacion: VerificationStatus
  /**
   * El resultado del registro, entregado UNA sola vez y borrado en la misma
   * operación. Ausente si ya se entregó (a tu destino o a una consulta anterior).
   */
  valores?: RegistryValues
}

export type WebhookEvent =
  | 'curp.verification.completed'
  | 'curp.verification.failed'
  | 'curp.verification.retrying'
  | 'curp.verification.manual_review'

/** El cuerpo que llega a tu webhook. */
export interface WebhookEnvelope {
  version: string
  event: WebhookEvent | (string & {})
  idempotencyKey: string
  documentType: 'curp'
  source: 'api' | 'web'
  captureLinkId: string | null
  reference: string | null
  extractedAt: string
  /**
   * `completed`: los campos de RegistryValues. `failed`: `estatus: SIN_RESPUESTA`
   * y `motivo`. `retrying` / `manual_review`: avance del trabajo. Todo es texto.
   */
  data: Record<string, string>
}
