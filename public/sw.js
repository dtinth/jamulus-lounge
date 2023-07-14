// Service worker

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  self.clients.claim()
})

// Active streams
const streams = new Map()

self.addEventListener('message', (e) => {
  const { data } = e
  if (data.openStream) {
    const { id, type } = data.openStream
    const stream = streams.get(id)
    if (stream) {
      console.log('[sw] openStream', id, 'already exists')
      return
    }
    console.log('[sw] openStream', id)
    streams.set(id, { listeners: new Set(), type })
    e.source.postMessage({ streamOpened: { id } })
    return
  }
  if (data.closeStream) {
    const { id } = data.closeStream
    console.log('[sw] closeStream', id)
    const stream = streams.get(id)
    if (stream) {
      for (const f of stream.listeners) {
        f(null)
      }
    }
    streams.delete(id)
    return
  }
  if (data.writeToStream) {
    const { id, data: streamData } = data.writeToStream
    const stream = streams.get(id)
    if (stream) {
      for (const f of stream.listeners) {
        f(streamData)
      }
    }
    return
  }
})

self.addEventListener('fetch', (e) => {
  // Intercept fetch requests to /__streams__/[id] and respond with data from the stream
  const { request } = e
  const url = new URL(request.url)
  if (url.pathname.startsWith('/__streams__/')) {
    const id = url.pathname.slice('/__streams__/'.length)
    const stream = streams.get(id)
    if (!stream) {
      e.respondWith(new Response('Unknown stream ' + id, { status: 404 }))
      return
    }
    console.log('[sw] stream', id, 'requested')
    let onCancel = () => {}
    e.respondWith(
      new Response(
        new ReadableStream({
          start(controller) {
            const listener = (data) => {
              if (data === null) {
                controller.close()
              } else {
                controller.enqueue(data)
              }
            }
            stream.listeners.add(listener)
            onCancel = () => {
              stream.listeners.delete(listener)
              controller.close()
            }
          },
          cancel() {
            onCancel()
          },
        }),
        {},
      ),
    )
  }
})
