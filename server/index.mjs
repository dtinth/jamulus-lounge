import url from 'url'
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

fastify.get('/mp3', (request, reply) => {
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

fastify.listen({ port: 9998 })
