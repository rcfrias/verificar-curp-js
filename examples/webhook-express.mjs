// npm i express && CURP_WEBHOOK_SECRET=whsec_... node examples/webhook-express.mjs
import express from 'express'
import { parseWebhook } from 'verificar-curp'

const app = express()

app.post('/webhooks/curp', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await parseWebhook({
      secret: process.env.CURP_WEBHOOK_SECRET,
      rawBody: req.body,
      signature: req.get('X-Signature'),
      timestamp: req.get('X-Signature-Timestamp'),
    })
    console.log(event.event, event.idempotencyKey, event.data)
    res.sendStatus(200)
  } catch (err) {
    console.error(err.message)
    res.sendStatus(400)
  }
})

app.listen(3000, () => console.log('Escuchando en :3000'))
