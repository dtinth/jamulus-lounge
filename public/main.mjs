import {
  html,
  render,
  useRef,
  useState,
  useEffect,
} from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js'

let sid = ''
let getActionDelay = () => 0

const server = new URLSearchParams(location.search).get('apiserver') || '.'
const eventSource = new EventSource(server + '/events')
const currentData = {}
Object.assign(window, { currentData })
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  setTimeout(() => {
    handleData(data)
  }, getActionDelay())
})
function handleData(data) {
  if (data.clients) {
    currentData.clients = data.clients
  }
  if (data.levels) {
    currentData.levels = data.levels
  }
  if (currentData.clients) {
    render(
      html`<div class="d-flex gap-2 flex-column">
        ${currentData.clients.map((c, i) => {
          const level = currentData.levels?.[i] || 0
          const percentage = Math.min(100, Math.round((level / 8) * 100))
          const hue = Math.round((c.instrument / 48) * 360) % 360
          return html`<div
            style="font-size: 0.8em; line-height: 1.2; --hue: ${hue}deg;"
            class="text-center d-flex flex-column gap-1 text-sm overflow-hidden"
          >
            <div
              style="height: 24px; background: hsl(var(--hue), 20%, 20%);"
              class="overflow-hidden rounded d-flex"
            >
              <div
                style="width: ${percentage}%; background: hsl(var(--hue), 80%, 80%);"
                class="rounded"
              ></div>
            </div>
            <div class="text-start">${c.name.padEnd(16)}</div>
          </div>`
        })}
      </div>`,
      document.querySelector('#members'),
    )
  }
}

class AudioFetcher {
  constructor(callback) {
    this.abortController = new AbortController()
    this.start(callback)
  }
  dispose() {
    this.abortController.abort()
  }
  async start(callback) {
    try {
      sid = crypto.randomUUID()
      const response = await fetch(server + '/mp3?sid=' + sid, {
        signal: this.abortController.signal,
      })
      if (!response.ok) {
        throw new Error('Cannot load audio stream, error ' + response.status)
      }
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        callback(value)
      }
    } catch (e) {
      console.error(e)
    }
  }
}

class AudioStream {
  subscribers = new Set()
  subscribe(callback) {
    const s = { callback }
    this.subscribers.add(s)
    this._update()
    return () => {
      this.subscribers.delete(s)
      this._update()
    }
  }
  _update() {
    if (this.subscribers.size > 0) {
      if (!this.fetcher) {
        this.fetcher = new AudioFetcher((data) => {
          this.subscribers.forEach((s) => {
            s.callback(data)
          })
        })
      }
    } else {
      if (this.fetcher) {
        this.fetcher.dispose()
        this.fetcher = null
      }
    }
  }
}

const audioStream = new AudioStream()
Object.assign(window, { audioStream })

class AudioRecorder {
  subscribers = new Set()
  constructor() {
    const time = new Date(Date.now()).toISOString().replace(/\W/g, '')
    this.fileName = `jamulus-${time}.mp3`
    this.size = 0
    this.chunks = []
    this.stopped = false
    this._unsubscribe = audioStream.subscribe((data) => {
      this.size += data.byteLength
      this.chunks.push(data)
      this.subscribers.forEach((s) => {
        s.callback()
      })
    })
  }
  stop() {
    this.stopped = {
      href: URL.createObjectURL(new Blob(this.chunks, { type: 'audio/mpeg' })),
    }
    this._unsubscribe()
    this.subscribers.forEach((s) => {
      s.callback()
    })
  }
  subscribe(callback) {
    const s = { callback }
    this.subscribers.add(s)
    return () => {
      this.subscribers.delete(s)
    }
  }
}

function Player() {
  const [listening, setListening] = useState(false)
  const [recorders, setRecorders] = useState([])
  const toggleListen = () => {
    setListening(!listening)
  }
  const createRecorder = () => {
    setRecorders((r) => [...r, new AudioRecorder()])
  }
  const removeRecording = (rec) => {
    if (confirm('Delete recording?')) {
      setRecorders((r) => r.filter((r) => r !== rec))
    }
  }
  return html`<div class="d-flex flex-column gap-2">
    <div class="d-flex gap-2 justify-content-center">
      ${listening
        ? html`<button class="btn btn-secondary" onClick=${toggleListen}>
            Stop Listening
          </button>`
        : html`<button class="btn btn-primary" onClick=${toggleListen}>
            Listen
          </button>`}
      ${listening && html`<${Listener} />`}
      <button class="btn btn-danger" onClick=${createRecorder}>Record</button>
    </div>
    ${recorders.map((rec) => {
      return html`<${Recorder}
        recorder=${rec}
        onDelete=${() => removeRecording(rec)}
      />`
    })}
  </div>`
}

function Listener() {
  const ref = useRef()
  useEffect(() => {
    const audioEl = ref.current
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    const mediaSource = new MediaSource()
    const unsubscribe = audioStream.subscribe((data) => {
      writer.write(data)
    })
    mediaSource.addEventListener('sourceopen', async () => {
      const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
      let onUpdateEnd = () => {}
      sourceBuffer.addEventListener('updateend', () => {
        onUpdateEnd()
      })
      let received = false
      for await (const chunk of streamAsyncIterator(stream.readable)) {
        await new Promise((resolve) => {
          onUpdateEnd = resolve
          sourceBuffer.appendBuffer(chunk)
        })
        if (!received) {
          received = true
          setTimeout(() => {
            audioEl.play()
          }, 1000)
        }
      }
    })
    audioEl.src = URL.createObjectURL(mediaSource)
    getActionDelay = createGetActionDelay(audioEl)
    return () => {
      unsubscribe()
      writer.close()
      getActionDelay = () => 0
    }
  }, [])
  return html`<audio ref=${ref} />`
}

function createGetActionDelay(audioEl) {
  let last
  return () => {
    if (last && Date.now() < last.time + 1000) {
      return last.value
    }
    try {
      const value =
        (audioEl.buffered.end(audioEl.buffered.length - 1) -
          audioEl.currentTime) *
        1000
      last = { time: Date.now(), value }
      return value
    } catch (e) {
      return 0
    }
  }
}

function Recorder(props) {
  const [size, setSize] = useState(0)
  const [stopped, setStopped] = useState(null)
  const stop = () => {
    props.recorder.stop()
  }
  useEffect(() => {
    return props.recorder.subscribe(() => {
      setSize(props.recorder.size)
      setStopped(props.recorder.stopped)
    })
  })
  return html`<div
    class="d-flex gap-2 align-items-center justify-content-center"
  >
    <div class="text-start">${props.recorder.fileName}</div>
    <div>${(size / 1024 / 1024).toFixed(2)} MB</div>
    <div class="d-flex gap-1">
      ${!stopped &&
      html`<button class="btn btn-sm btn-secondary" onClick=${stop}>
        Stop
      </button>`}
      ${stopped &&
      html`<a
          class="btn btn-sm btn-outline-success"
          href=${stopped.href}
          download=${props.recorder.fileName}
        >
          Download
        </a>
        <button class="btn btn-sm btn-outline-danger" onClick=${props.onDelete}>
          Delete
        </button>`}
    </div>
  </div>`
}

// See: https://github.com/whatwg/streams/issues/778#issuecomment-325097792
async function* streamAsyncIterator(stream) {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

function Chat() {
  return html`<div class="card mb-4">
    <div class="card-header">Chat</div>
    <div class="card-body">.</div>
    <div class="card-footer text-center">
      <form class="d-flex gap-2">
        <input type="text" class="form-control" id="chatText" />
        <input type="submit" class="btn btn-outline-primary" value="Send" />
      </form>
      <em class="text-muted">Listen in to chat</em>
    </div>
  </div>`
}

render(html`<${Player} />`, document.querySelector('#player'))
render(html`<${Chat} />`, document.querySelector('#chat'))
