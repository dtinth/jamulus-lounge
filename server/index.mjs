import url from 'url'
import fs from 'fs'
import axios from 'axios'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyReplyFrom from '@fastify/reply-from'

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})
fastify.register(fastifyStatic, {
  root: url.fileURLToPath(new URL('../public', import.meta.url)),
})
fastify.register(fastifyReplyFrom, {
  base: 'http://localhost:9999',
})

const listeners = new Map()
const logger = fastify.log
const client = axios.create({ baseURL: 'http://localhost:9999' })
let lastName = ''

async function worker() {
  try {
    const name = `  lobby [${listeners.size}]  `
    if (name === lastName) return
    await client.patch('/channel-info', {
      name: name,
      skillLevel: 3,
      instrument: 24,
    })
    logger.info(`Set client name to "${name}"`)
    lastName = name
  } catch (err) {
    logger.error({ err })
  }
}

setInterval(worker, 2500)
worker()

fastify.get('/config', async (request, reply) => {
  const config = {
    ...JSON.parse(await fs.promises.readFile('config.example.json', 'utf8')),
    ...JSON.parse(
      await fs.promises.readFile('config.json', 'utf8').catch((e) => {
        return '{}'
      }),
    ),
  }
  return { config }
})

fastify.get('/mp3', (request, reply) => {
  if (request.headers.range === 'bytes=0-1') {
    // Send 2 bytes to make the browser think it's an mp3
    return reply
      .code(206)
      .header('Content-Range', 'bytes 0-1/2')
      .header('Content-Type', 'audio/mpeg')
      .send(Buffer.from('ID'))
  }
  const sid = String(request.query.sid || '').slice(0, 36)
  if (!sid || listeners.has(sid)) {
    return reply.code(409).send('Already listening')
  }
  const name = String(request.query.name || '').slice(0, 16)
  if (!name) {
    return reply.code(400).send('Missing name')
  }
  listeners.set(sid, { name })
  request.log.info(`New listener: ${name} (${sid})`)
  reply.raw.on('close', () => {
    listeners.delete(sid)
    request.log.info(`Listener disconnected: ${name} (${sid})`)
  })
  reply.from('/mp3')
})

fastify.get('/events', (request, reply) => {
  reply.from('/events')
})

fastify.post('/chat', async (request, reply) => {
  const user = listeners.get(String(request.body.sid))
  if (!user) {
    return reply.code(400).send('Invalid sid')
  }
  const text = request.body.text
  const name = user.name
  request.log.info(`Send chat: [${name}] ${text}`)
  await client.post('/chat', { message: `[${name}] ${text}` })
  return { ok: true }
})

fastify.get('/listeners', async (request, reply) => {
  return Array.from(listeners).map(([k, v]) => ({
    name: v.name,
  }))
})

fastify.listen({ port: 9998, host: '127.0.0.1' })
