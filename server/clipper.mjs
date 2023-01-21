import Fastify from 'fastify'
import http from 'http'
import { Readable } from 'stream'

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
    this.time = time
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
    const cutoff = performance.now() - 600e3
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
      timestamp: this.head.timestamp,
      [Symbol.iterator]() {
        return iterator
      },
    }
  }
}

const clipBuffer = new ClipBuffer()

http.get('http://localhost:9999/mp3', async (res) => {
  if (res.statusCode !== 200) {
    throw new Error('Bad status code')
  }
  for await (const buffer of res) {
    clipBuffer.add(buffer)
  }
  process.exit(1)
})

async function* clipToStream(clip) {
  for (const node of clip) {
    yield node.data
  }
}

fastify.get('/clip', async (request, reply) => {
  const clip = clipBuffer.clip()
  if (!clip) {
    return reply.code(404).send('No clip available')
  }
  reply.header('Content-Type', 'audio/mpeg')
  reply.header('Content-Length', clip.size)
  const filename =
    'clip-' +
    new Date(Date.now() - 60e3 * new Date().getTimezoneOffset())
      .toISOString()
      .replace(/:/g, '-')
      .split('.')[0] +
    '.mp3'
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
  const stream = Readable.from(clipToStream(clip), { objectMode: false })
  return reply.send(stream)
})

fastify.listen({ port: 9997, host: '127.0.0.1' })
