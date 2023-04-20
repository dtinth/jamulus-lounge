import Fastify from 'fastify'
import http from 'http'
import { Readable } from 'stream'
import EventSource from 'eventsource'
import archiver from 'archiver'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import axios from 'axios'

const MAX_CLIP_TIME = 600e3

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

class ClipBufferNode {
  constructor(data, time, timestamp, offset, size) {
    this.data = data

    /** High performance timer */
    this.time = time

    /** Date.now() */
    this.timestamp = timestamp

    this.offset = offset
    this.size = size
    this.next = null
  }
}

class ClipBuffer {
  constructor() {
    this.head = null
    this.tail = null
    this.offset = 0
  }
  add(buffer, size = buffer.length) {
    const time = performance.now()
    const node = new ClipBufferNode(buffer, time, Date.now(), this.offset, size)
    if (this.tail) {
      this.tail.next = node
    }
    this.tail = node
    if (!this.head) {
      this.head = node
    }
    this.prune()
    this.offset += size
  }
  prune() {
    const cutoff = performance.now() - MAX_CLIP_TIME
    while (this.head && this.head.time < cutoff) {
      this.head = this.head.next
    }
  }
  clip() {
    this.prune()
    let node = this.head
    if (!node) return null
    const cutoff = this.tail.time
    const size = this.tail.offset - this.head.offset + this.tail.size
    const timestamp = this.head.timestamp
    const time = this.head.time
    fastify.log.info(
      'Clipping from ' +
        new Date(timestamp).toISOString() +
        ' with length ' +
        Math.round(cutoff - node.time) +
        'ms',
    )
    const iterator = (function* () {
      let sent = 0
      while (node && node.time <= cutoff) {
        yield node
        sent += node.size
        node = node.next
      }
      fastify.log.info(`Sent ${sent}/${size} bytes of clip`)
    })()
    return {
      size,
      timestamp,
      startTime: time,
      endTime: cutoff,
      [Symbol.iterator]() {
        return iterator
      },
    }
  }
}

class EventBufferNode {
  constructor(time, timestamp, state, event) {
    this.time = time
    this.timestamp = timestamp
    this.state = state
    this.event = event
    this.next = null
  }
}

class EventBuffer {
  constructor() {
    this.head = null
    this.tail = null
    this.size = 0
  }
  add(state, event) {
    const time = performance.now()
    const node = new EventBufferNode(time, Date.now(), state, event)
    if (this.tail) {
      this.tail.next = node
    }
    this.tail = node
    if (!this.head) {
      this.head = node
    }
    this.prune()
    this.size++
  }
  prune() {
    const cutoff = performance.now() - MAX_CLIP_TIME
    while (this.head && this.head.time < cutoff) {
      this.head = this.head.next
      this.size--
    }
  }
  slice(startTime, endTime) {
    let node = this.head
    if (!node) return null
    const out = []
    let initialState
    while (node && node.time <= endTime) {
      if (node.time >= startTime) {
        if (!initialState) {
          initialState = node.state
        }
        out.push({
          time: node.time,
          timestamp: node.timestamp,
          data: node.event,
        })
      }
      node = node.next
    }
    return [initialState, out]
  }
}

const clipBuffer = new ClipBuffer()
const eventBuffer = new EventBuffer()

http.get('http://localhost:9999/mp3', async (res) => {
  if (res.statusCode !== 200) {
    throw new Error('Bad status code')
  }
  for await (const buffer of res) {
    clipBuffer.add(buffer)
  }
  process.exit(1)
})

const eventSource = new EventSource('http://localhost:9999/events')
let currentState = {}
const seenId = new Set()
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  eventBuffer.add(currentState, data)
  if (data.clients) {
    currentState = { ...currentState, clients: data.clients }
  }
  if (data.levels) {
    currentState = { ...currentState, levels: data.levels }
  }
  if (data.newChatMessage) {
    const { id, message } = data.newChatMessage
    if (message.match(/>\s+\/clip\s*$/)) {
      if (!seenId.has(id)) {
        seenId.add(id)
        generateClipMessage()
      }
    }
  }
})

async function* clipToStream(clip) {
  for (const node of clip) {
    yield node.data
  }
}

fastify.get('/', async (request, reply) => {
  return {
    name: 'jamulus-clipper',
    audio: clipBuffer.offset,
    events: eventBuffer.size,
  }
})

async function generateClipArchive() {
  const clip = clipBuffer.clip()
  if (!clip) return null
  if (!process.env.CLIPPER_DIR) return null
  const archive = archiver('zip', { store: true })
  const stream = Readable.from(clipToStream(clip), { objectMode: false })
  archive.append(stream, { name: 'audio.mp3' })
  const [initialState, events] = eventBuffer.slice(clip.startTime, clip.endTime)
  const result = [
    {
      initial: {
        state: initialState,
        startTime: clip.startTime,
        endTime: clip.endTime,
      },
    },
    ...events.map((event) => ({ event })),
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')
  archive.append(result, { name: 'events.ndjson' })
  archive.finalize()
  const filename =
    'clip-' +
    new Date(clip.timestamp - 60e3 * new Date().getTimezoneOffset())
      .toISOString()
      .replace(/:/g, '-')
      .split('.')[0] +
    '.zip'
  await pipeline(
    archive,
    createWriteStream(process.env.CLIPPER_DIR + '/' + filename),
  )
  return filename
}

async function generateClipMessage() {
  try {
    if (!process.env.CLIPPER_URL) return
    const clip = await generateClipArchive()
    if (!clip) return
    const url = process.env.CLIPPER_URL + '/' + clip
    const message = `${url}`
    fastify.log.info(message)
    await axios.post('http://localhost:9999/chat', { message })
  } catch (e) {
    fastify.log.error({ err: e }, 'Error generating clip')
  }
}

fastify.post('/generate', async (request, reply) => {
  const clip = await generateClipArchive()
  return { clip }
})

fastify.get('/clip', async (request, reply) => {
  const clip = clipBuffer.clip()
  if (!clip) {
    return reply.code(404).send('No clip available')
  }
  reply.header('Content-Type', 'audio/mpeg')
  reply.header('Content-Length', clip.size)
  const filename =
    'clip-' +
    new Date(clip.timestamp - 60e3 * new Date().getTimezoneOffset())
      .toISOString()
      .replace(/:/g, '-')
      .split('.')[0] +
    '.mp3'
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
  const stream = Readable.from(clipToStream(clip), { objectMode: false })
  return reply.send(stream)
})

fastify.listen({ port: 9997, host: '127.0.0.1' })
