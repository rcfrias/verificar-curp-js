# verificar-curp

SDK oficial de [Verificar CURP](https://verificarcurp.com) para Node.js y TypeScript.

- **Valida** la estructura de una CURP (entidad, fecha, dígito verificador) y te dice qué está mal.
- **Coteja** la CURP con los datos que ya tienes de la persona (nombre, apellidos, fecha, sexo, entidad).
- **Verifica** la CURP en el registro RENAPO; el resultado llega a tu webhook, correo o chat.
- **Verifica la firma** de los webhooks que te enviamos.

Sin dependencias. Node 18+, Deno, Bun y Cloudflare Workers.

```bash
npm install verificar-curp
```

## Uso

```ts
import { VerificarCurpClient } from 'verificar-curp'

const client = new VerificarCurpClient({ apiKey: process.env.CURP_API_KEY! })

const { data, tokensRemaining } = await client.validate({
  curp: 'PEGJ850101HDFRRL04',
  persona: { nombres: 'Julio', fechaNacimiento: '1985-01-01', sexo: 'H' },
})

data.valida       // true
data.entidad      // 'Ciudad de México'
data.cotejo       // 'coincide' | 'no_coincide' | 'indeterminado'
data.cotejoCampos // { nombres: 'coincide', fechaNacimiento: 'coincide', sexo: 'coincide' }
```

Una CURP mal formada no es un error: responde `data.valida === false` y el motivo en `data.razon`
(por ejemplo `{ kind: 'check-digit', expected: '4', actual: '9' }`).

En `persona`, `segundoApellido: null` significa "no tiene segundo apellido" y se compara; si omites
el campo, no se compara.

## Verificar en RENAPO

```ts
const { verificacion } = await client.validate({
  curp: 'PEGJ850101HDFRRL04',
  verificar: true,
  destinationId: 'dst_...', // panel → Destinos
  idempotencyKey: 'cliente-123', // opcional; nunca pongas la CURP aquí
})

if (verificacion?.aceptada) {
  console.log('En curso:', verificacion.job_id)
} else if (verificacion) {
  console.log('No se pudo iniciar:', verificacion.codigo, 'reintenta en', verificacion.retry_after, 's')
}
```

El resultado del registro (`estatus`: `ACTIVA`, `BAJA`, `RNE` o `NO_ENCONTRADA`) llega a tu destino,
normalmente en segundos. También puedes consultar el estado, sin costo:

```ts
const { verificacion, valores } = await client.getVerification(jobId)
```

`valores` llega **una sola vez** y se borra en la misma operación. Si tu destino ya lo recibió, aquí
solo verás el estado; es la forma de recuperarlo cuando la entrega a tu destino falló.

## Recibir el webhook

Verifica la firma con el cuerpo **crudo**, antes de interpretarlo:

```ts
import express from 'express'
import { parseWebhook } from 'verificar-curp'

const app = express()

app.post('/webhooks/curp', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await parseWebhook({
      secret: process.env.CURP_WEBHOOK_SECRET!, // whsec_…
      rawBody: req.body,
      signature: req.get('X-Signature'),
      timestamp: req.get('X-Signature-Timestamp'),
    })

    if (event.event === 'curp.verification.completed') {
      console.log(event.idempotencyKey, event.data.estatus)
    }
    res.sendStatus(200)
  } catch {
    res.sendStatus(400)
  }
})
```

`verifyWebhookSignature()` hace lo mismo y devuelve `true`/`false`. Por defecto rechaza firmas con más
de 300 s de antigüedad (`toleranceSeconds`). Eventos: `curp.verification.completed`, `.failed`,
`.retrying` y `.manual_review`.

## Saldo

```ts
const tokens = await client.getBalance()
```

## Errores

Todo fallo lanza `VerificarCurpError`, con `code`, `status` y el cuerpo crudo en `response`:

```ts
import { VerificarCurpError } from 'verificar-curp'

try {
  await client.validate({ curp })
} catch (err) {
  if (err instanceof VerificarCurpError && err.code === 'INSUFFICIENT_TOKENS') {
    // recarga tokens en https://verificarcurp.com
  }
}
```

| code | status | cuándo |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Cuerpo inválido |
| `DESTINATION_NOT_FOUND` | 400 | El destino no existe o no es tuyo (no se cobra) |
| `MISSING_API_KEY` / `INVALID_API_KEY` | 401 | API key ausente o incorrecta |
| `INSUFFICIENT_TOKENS` | 402 | Sin saldo (`blockReason` explica si hay bloqueo) |
| `NOT_FOUND` | 404 | La verificación no es de tu cuenta |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Misma `idempotencyKey` con otra CURP |
| `INTERNAL_ERROR` | 500 | Error del servidor |
| `NETWORK_ERROR` / `TIMEOUT` | — | Del SDK |
| `INVALID_INPUT` / `INVALID_SIGNATURE` | — | Del SDK |

## Opciones

```ts
new VerificarCurpClient({
  apiKey: '...',
  baseUrl: 'https://verificarcurp.com/api/v1', // por defecto
  timeoutMs: 30_000, // por defecto
  fetch: customFetch, // opcional
})
```

## Enlaces

- Documentación: https://verificarcurp.com/docs
- OpenAPI: https://verificarcurp.com/api/openapi.yaml
- Python: https://pypi.org/project/verificar-curp/

MIT
