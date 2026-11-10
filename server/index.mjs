import fastifyReplyFrom from '@fastify/reply-from'
import fastifyStatic from '@fastify/static'
import axios from 'axios'
import Fastify from 'fastify'
import fs from 'fs'
import url from 'url'
import {
  GOJAM_API_HOST,
  GOJAM_API_PORT,
  LISTEN_HOST,
  LOUNGE_ADMIN_PORT,
  LOUNGE_SERVER_PORT,
  MAX_STREAMS_PER_IP,
} from './env.mjs'

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
  base: `http://${GOJAM_API_HOST}:${GOJAM_API_PORT}`,
})

const state = {}
const listeners = new Map()

// Number of concurrent /mp3 streams per client IP address, so that one client
// cannot exhaust the server by opening a large number of streams.
const streamsByIp = new Map()

// The lounge normally runs behind a reverse proxy (see README), so the socket
// peer is the proxy. Use the first X-Forwarded-For entry, which is the client
// address as set by the proxy (Caddy overwrites the header by default).
function getClientIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '')
  return forwarded.split(',')[0].trim() || request.socket.remoteAddress || ''
}

const logger = fastify.log
const client = axios.create({ baseURL: `http://${GOJAM_API_HOST}:${GOJAM_API_PORT}` })
let lastKey = ''

async function worker() {
  try {
    const name = `  lobby [${listeners.size}]  `
    const instrument = state.recording ? 23 : 24
    const key = [name, instrument].join(':')
    if (key === lastKey) return
    await client.patch('/channel-info', {
      name,
      skillLevel: 3,
      instrument,
    })
    logger.info(`Set client name to "${name}"`)
    lastKey = name
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
    // Send a single MP3 frame to make the browser think this is an MP3 file
    const mp3Frame = Buffer.from([
      0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    reply.status(206)
    reply.header('Content-Type', 'audio/mpeg')
    reply.header('Content-Length', mp3Frame.length)
    reply.send(mp3Frame)
    return
  }
  const sid = String(request.query.sid || '').slice(0, 36)
  if (!sid || listeners.has(sid)) {
    return reply.code(409).send('Already listening')
  }
  const name = String(request.query.name || '').slice(0, 16)
  if (!name) {
    return reply.code(400).send('Missing name')
  }
  const ip = getClientIp(request)
  const streams = streamsByIp.get(ip) || 0
  if (MAX_STREAMS_PER_IP > 0 && streams >= MAX_STREAMS_PER_IP) {
    request.log.warn(`Too many streams from ${ip} (${streams}), refusing ${name} (${sid})`)
    return reply.code(429).send('Too many streams from your address')
  }
  streamsByIp.set(ip, streams + 1)
  listeners.set(sid, { name })
  request.log.info(`New listener: ${name} (${sid})`)
  reply.raw.on('close', () => {
    listeners.delete(sid)
    const left = (streamsByIp.get(ip) || 1) - 1
    if (left > 0) streamsByIp.set(ip, left)
    else streamsByIp.delete(ip)
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

const adminFastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

adminFastify.get('/state', async (request, reply) => {
  return state
})
adminFastify.patch('/state', async (request, reply) => {
  Object.assign(state, request.body)
  return state
})

fastify.listen({ port: LOUNGE_SERVER_PORT, host: LISTEN_HOST })
adminFastify.listen({ port: LOUNGE_ADMIN_PORT, host: LISTEN_HOST })
