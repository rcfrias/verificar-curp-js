// node examples/validar.mjs PEGJ850101HDFRRL04
import { VerificarCurpClient } from 'verificar-curp'

const client = new VerificarCurpClient({ apiKey: process.env.CURP_API_KEY })
const curp = process.argv[2] ?? 'PEGJ850101HDFRRL04'

const { data, tokensRemaining } = await client.validate({ curp })
console.log(data.valida ? 'Válida' : 'No válida', data.razon ?? '', data.entidad ?? '')
console.log('Tokens restantes:', tokensRemaining)
