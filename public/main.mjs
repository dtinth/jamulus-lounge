import {
  html,
  render,
  useRef,
  useState,
  useEffect,
} from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js'

let flagSet
export function isQueryFlagEnabled(flagName) {
  if (!flagSet) {
    flagSet = new Set(
      (new URLSearchParams(window.location.search).get('flags') || '')
        .split(',')
        .filter(Boolean),
    )
  }
  return flagSet.has(flagName)
}

function createAtom(v) {
  const a = {
    listeners: new Set(),
    get value() {
      return v
    },
    set value(newValue) {
      v = newValue
      a.listeners.forEach((l) => l())
    },
    subscribe(listener) {
      a.listeners.add(listener)
      return () => a.listeners.delete(listener)
    },
  }
  return a
}
function useAtom(a) {
  const [, set] = useState()
  useEffect(() => a.subscribe(() => set({})), [a])
  return a.value
}

let sid = createAtom('')
let welcomeHtmlAtom = createAtom('')
let nameAsked = false
let listenerName = createAtom(localStorage.jamulusLoungeListenerName || '')
let getActionDelay = () => 0

const server = new URLSearchParams(location.search).get('apiserver') || '.'
const eventSource = new EventSource(server + '/events')
const currentData = {}
const dataListeners = new Set()

Object.assign(window, { currentData })

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  for (const listener of dataListeners) {
    listener(data)
  }
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
  if (data.newChatMessage) {
    console.log('[New chat message]', data.newChatMessage)
    // Dispatch a DOM event
    const event = new CustomEvent('jamuluschat', {
      detail: data.newChatMessage,
    })
    document.dispatchEvent(event)
  }
  if (currentData.clients) {
    let clients = insertLevel(currentData.clients, currentData.levels)
    if (isQueryFlagEnabled('active-only')) {
      clients = filterActiveOnly(clients)
    }
    render(
      html`<div
        class="gap-3 flex-column"
        style="display: grid; grid-template-columns: repeat(var(--columns, 2), minmax(0, 1fr));"
      >
        ${clients.map((c) => {
          const level = c.level
          const percentage = Math.min(100, Math.round((level / 8) * 100))
          const hue = Math.round((c.instrument / 48) * 360) % 360
          return html`<div
            style="font-size: 0.8em; line-height: 1.2; --hue: ${hue}deg;"
            class="col text-center d-flex flex-column gap-1 text-sm overflow-hidden"
            key=${c.index}
          >
            <div class="text-start" style="flex: 1 0">${c.name.padEnd(16)}</div>
            <div
              style="height: 24px; background: hsl(var(--hue), 20%, 20%);"
              class="overflow-hidden rounded d-flex"
            >
              <div
                style="width: ${percentage}%; background: hsl(var(--hue), 80%, 80%);"
                class="rounded"
              ></div>
            </div>
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
    const mySid = crypto.randomUUID()
    try {
      sid.value = mySid
      const response = await fetch(
        `${server}/mp3?${new URLSearchParams({
          sid: sid.value,
          name: listenerName.value,
        })}`,
        { signal: this.abortController.signal },
      )
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
    } finally {
      if (sid.value === mySid) {
        sid.value = ''
      }
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
    this.ndjson = [
      JSON.stringify({
        initial: {
          state: {
            clients: currentData.clients || [],
            levels: currentData.levels || [],
          },
          startTime: performance.now(),
        },
      }) + '\n',
    ]
    this._unsubscribeStream = audioStream.subscribe((data) => {
      this.size += data.byteLength
      this.chunks.push(data)
      this.subscribers.forEach((s) => {
        s.callback()
      })
    })
    const dataListener = (data) => {
      this.ndjson.push(
        JSON.stringify({
          event: {
            time: performance.now(),
            timestamp: Date.now(),
            data,
          },
        }) + '\n',
      )
    }
    dataListeners.add(dataListener)
    this._unsubscribeData = () => {
      dataListeners.delete(dataListener)
    }
  }
  stop() {
    this.stopped = {
      href: URL.createObjectURL(new Blob(this.chunks, { type: 'audio/mpeg' })),
      eventsHref: URL.createObjectURL(
        new Blob(this.ndjson, { type: 'application/x-ndjson' }),
      ),
    }
    this._unsubscribeStream()
    this._unsubscribeData()
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

function ensureName(forceAsk = true) {
  if (listenerName.value && !forceAsk) {
    return true
  }
  const name = (
    prompt('Enter your name to connect', listenerName.value || '') || ''
  )
    .trim()
    .slice(0, 16)
    .trim()
  if (!name) {
    return false
  }
  listenerName.value = name
  localStorage.jamulusLoungeListenerName = listenerName.value
  nameAsked = true
  return true
}

function Player() {
  const [listening, setListening] = useState(false)
  const [recorders, setRecorders] = useState([])
  const currentSid = useAtom(sid)
  const toggleListen = () => {
    const nextListening = !listening
    if (nextListening) {
      if (!ensureName(!listening)) {
        return
      }
    }
    setListening(nextListening)
  }
  const createRecorder = () => {
    if (!ensureName(!listening && !nameAsked)) {
      return
    }
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
    ${!!listening &&
    !currentSid &&
    html`<div class="text-danger text-center">
      You have been disconnected from the server. Please
      ${recorders.length > 0 ? ' download all the recordings, ' : ' '}refresh
      the page and try again later. Please note that
      <strong>iOS is not supported.</strong>
    </div>`}
    ${recorders.length > 0 &&
    html`<div class="d-flex flex-column gap-2 mt-3">
      ${recorders.map((rec) => {
        return html`<${Recorder}
          recorder=${rec}
          onDelete=${() => removeRecording(rec)}
        />`
      })}
    </div>`}
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
  return html`<div>
    <div class="text-start text-muted" style="font-size: 0.8em">
      ${props.recorder.fileName}
    </div>
    <div class="d-flex gap-2 align-items-center justify-content-center">
      <div style="flex: auto">${(size / 1024 / 1024).toFixed(2)} MB</div>
      <div class="d-flex gap-1">
        ${!stopped &&
        html`<button class="btn btn-sm btn-outline-secondary" onClick=${stop}>
          Stop
        </button>`}
        ${stopped &&
        html`<a
            class="btn btn-sm btn-outline-secondary"
            href=${stopped.eventsHref}
            download=${props.recorder.fileName.replace(/\.\w+$/, '.ndjson')}
          >
            {}
          </a>
          <a
            class="btn btn-sm btn-outline-success"
            href=${stopped.href}
            download=${props.recorder.fileName}
          >
            Download
          </a>
          <button
            class="btn btn-sm btn-outline-danger"
            onClick=${props.onDelete}
          >
            Delete
          </button>`}
      </div>
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

const exampleChatData = [
  {
    id: 'x7f7acd4-2692-47a3-90c5-148eb6dda299',
    message:
      '\u003cfont color="green"\u003e(08:30:24 PM) \u003cb\u003etest\u003c/b\u003e\u003c/font\u003e Hello World',
    timestamp: '2023-01-11T13:30:24.189273042Z',
  },
  {
    id: 'x67f2750-fb8c-4891-8e07-f205de4506b2',
    message:
      '\u003cfont color="green"\u003e(08:31:57 PM) \u003cb\u003etest\u003c/b\u003e\u003c/font\u003e testing',
    timestamp: '2023-01-11T13:31:57.78517846Z',
  },
  {
    id: 'xf7d4757-7937-40ad-a155-812428b4f86d',
    message:
      '\u003cfont color="green"\u003e(08:32:26 PM) \u003cb\u003etest\u003c/b\u003e\u003c/font\u003e meow',
    timestamp: '2023-01-11T13:32:26.502031767Z',
  },
  {
    id: 'xd5ceea8-0403-40c4-a17f-371bd7bb1c9b',
    message:
      '\u003cfont color="green"\u003e(08:35:03 PM) \u003cb\u003etest\u003c/b\u003e\u003c/font\u003e nyan',
    timestamp: '2023-01-11T13:35:03.311070085Z',
  },
]

const insertLevel = (clients, levels) => {
  return clients.map((c, i) => {
    const level = levels?.[i] || 0
    const index = c
    return { ...c, level, index }
  })
}

const filterActiveOnly = (() => {
  const hp = new Map()
  const cLevel = new Map()
  return (clients) => {
    for (const c of clients) {
      if (c.level > 0) {
        hp.set(c.name, 32)
        cLevel.set(c.name, (cLevel.get(c.name) || 0) + c.level)
      } else {
        const cHp = hp.get(c.name) || 0
        if (cHp > 0) {
          hp.set(c.name, cHp - 1)
        } else {
          hp.delete(c.name)
          cLevel.delete(c.name)
        }
      }
    }
    return clients.filter((c) => {
      return hp.has(c.name)
    })
    // .sort((a, b) => {
    //  return (cLevel.get(b.name) || 0) - (cLevel.get(a.name) || 0)
    // })
  }
})()

function Chat() {
  const [messages, setMessages] = useState([])
  const currentSid = useAtom(sid)
  const currentName = useAtom(listenerName)
  const welcomeHtml = useAtom(welcomeHtmlAtom)
  const atBottom = useRef(true)
  const scrollableRef = useRef(null)
  useEffect(() => {
    const handle = (m) => {
      setMessages((messages) => {
        return [...messages, m]
      })
    }
    const handler = (e) => {
      handle(e.detail)
    }
    document.addEventListener('jamuluschat', handler)
    if (isQueryFlagEnabled('test-chat')) {
      for (const c of exampleChatData) {
        handle(c)
      }
    }
    if (isQueryFlagEnabled('test-chat-stream')) {
      setInterval(() => {
        const id = crypto.randomUUID()
        handle({
          id,
          message:
            '\u003cfont color="green"\u003e(HH:MM:SS XM) \u003cb\u003etest\u003c/b\u003e\u003c/font\u003e ' +
            id,
          timestamp: new Date().toISOString(),
        })
      }, 1000)
    }
    return () => {
      document.removeEventListener('jamuluschat', handler)
    }
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    const input = e.target.elements.chatText
    try {
      const response = await fetch(server + '/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sid: currentSid,
          text: input.value,
        }),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      input.value = ''
    } catch (err) {
      alert(`Unable to send: ${err}`)
    }
  }
  const handleScroll = (e) => {
    const el = scrollableRef.current
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 32
  }
  useEffect(() => {
    if (atBottom.current) {
      const el = scrollableRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [messages])
  return html`<div class="card mb-4">
    <div class="card-header">Chat</div>
    <div
      class="card-body"
      ref=${scrollableRef}
      onScroll=${handleScroll}
      style="overflow-y: auto; overflow-x: hidden; height: max(256px, 100vh - 256px);"
    >
      ${welcomeHtml
        ? html`<div>
            <div dangerouslySetInnerHTML=${{ __html: welcomeHtml }} />
            <hr />
          </div>`
        : null}
      ${messages.flatMap((m) => {
        // Example: <font color="green">(08:30:24 PM) <b>test</b></font> Hello World
        const regex =
          /<font color="[^"]+">\(([^)]+)\) <b>([^<]+)<\/b><\/font> (.*)/
        const match = m.message.match(regex)
        if (!match) {
          return []
        }
        return [
          html`<div key=${m.id}>
            <span class="text-muted">(${match[1]})</span>${' '}
            <strong>${match[2]}</strong>${' '} ${match[3]}
          </div>`,
        ]
      })}
    </div>
    <div class="card-footer text-center">
      ${currentSid && currentName
        ? html`<form class="d-flex gap-2" onSubmit=${submit}>
            <strong class="align-self-center">${currentName}</strong>
            <input
              type="text"
              class="form-control"
              name="chatText"
              id="chatText"
            />
            <input type="submit" class="btn btn-outline-primary" value="Send" />
          </form>`
        : html`<em class="text-muted">Listen in to chat</em>`}
    </div>
  </div>`
}

function Listeners() {
  const [listeners, setListeners] = useState([])
  useEffect(() => {
    const refresh = async () => {
      const response = await fetch(server + '/listeners')
      const data = await response.json()
      if (Array.isArray(data)) setListeners(data)
    }
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [])
  return listeners.length
    ? html`<ul class="mb-0">
        ${listeners.map((d, i) => {
          return html`<li key=${i}>${d.name}</li>`
        })}
      </ul>`
    : html`<div class="text-center">
        <em class="text-muted">No listeners right now</em>
      </div>`
}

if (document.querySelector('#player')) {
  render(html`<${Player} />`, document.querySelector('#player'))
  render(html`<${Chat} />`, document.querySelector('#chat'))
  render(html`<${Listeners} />`, document.querySelector('#listeners'))
}

fetch(server + '/config').then(async (response) => {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const { config } = await response.json()
  if (config.title) {
    document.title = config.title
    document.querySelector('#app-title').innerText = config.title
  }
})

fetch('welcome.html').then(async (response) => {
  if (!response.ok) {
    console.warn('No welcome.html found')
    return
  }
  welcomeHtmlAtom.value = await response.text()
})
