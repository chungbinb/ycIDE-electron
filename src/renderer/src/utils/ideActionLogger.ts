type DebugApi = {
  logRendererEvent?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
  logRendererError?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
}

type ActionRecord = {
  ts: string
  type: string
  target: string
  lineIndex?: string | null
  key?: string
  code?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  button?: number
  valuePreview?: string
  valueLength?: number
  selectionText?: string
  clipboardPreview?: string
  clipboardLength?: number
  context?: Record<string, unknown>
}

const LOG_BATCH_SIZE = 30
const LOG_FLUSH_MS = 450

function isActionDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true
  const g = globalThis as {
    __EYC_ACTION_DEBUG__?: boolean
    __EYC_FLOW_PASTE_DEBUG__?: boolean
    localStorage?: { getItem: (key: string) => string | null }
  }
  if (g.__EYC_ACTION_DEBUG__ === true || g.__EYC_FLOW_PASTE_DEBUG__ === true) return true
  try {
    return g.localStorage?.getItem('__EYC_ACTION_DEBUG__') === '1'
      || g.localStorage?.getItem('__EYC_FLOW_PASTE_DEBUG__') === '1'
  } catch {
    return false
  }
}

function targetToString(target: EventTarget | null): string {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return '<unknown>'
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = (el.className && typeof el.className === 'string')
    ? '.' + el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    : ''
  return `${tag}${id}${cls}`
}

function clipText(input: string, limit = 120): string {
  if (!input) return ''
  return input.length > limit ? `${input.slice(0, limit)}...` : input
}

export function mountIdeActionLogger(getContext?: () => Record<string, unknown>): () => void {
  const api = (window as unknown as { api?: { debug?: DebugApi } }).api?.debug
  const queue: ActionRecord[] = []
  let flushTimer: number | null = null

  const flush = (): void => {
    flushTimer = null
    if (queue.length === 0 || !isActionDebugEnabled()) return
    const events = queue.splice(0, queue.length)
    const payload = {
      source: 'ide-action',
      message: 'action-batch',
      extra: { count: events.length, events },
    }
    if (api?.logRendererEvent) {
      void api.logRendererEvent(payload).catch(() => {
        if (api?.logRendererError) {
          void api.logRendererError(payload)
        }
      })
      return
    }
    if (api?.logRendererError) {
      void api.logRendererError(payload)
    }
  }

  const scheduleFlush = (): void => {
    if (queue.length >= LOG_BATCH_SIZE) {
      flush()
      return
    }
    if (flushTimer !== null) return
    flushTimer = window.setTimeout(flush, LOG_FLUSH_MS)
  }

  const push = (record: ActionRecord): void => {
    if (!isActionDebugEnabled()) return
    queue.push(record)
    scheduleFlush()
  }

  const onAnyEvent = (ev: Event): void => {
    const target = ev.target as HTMLElement | null
    const lineIndex = target?.closest?.('[data-line-index]')?.getAttribute?.('data-line-index') ?? null
    const base: ActionRecord = {
      ts: new Date().toISOString(),
      type: ev.type,
      target: targetToString(ev.target),
      lineIndex,
      context: getContext ? getContext() : undefined,
    }

    if (ev instanceof KeyboardEvent) {
      base.key = ev.key
      base.code = ev.code
      base.ctrl = ev.ctrlKey
      base.shift = ev.shiftKey
      base.alt = ev.altKey
      base.meta = ev.metaKey
    } else if (ev instanceof MouseEvent) {
      base.button = ev.button
    } else if (ev instanceof InputEvent) {
      const inputEl = target as HTMLInputElement | HTMLTextAreaElement | null
      const v = inputEl && typeof inputEl.value === 'string' ? inputEl.value : ''
      base.valueLength = v.length
      base.valuePreview = clipText(v)
    } else if (ev.type === 'selectionchange') {
      const sel = window.getSelection()?.toString() || ''
      base.selectionText = clipText(sel)
    } else if (ev.type === 'paste' || ev.type === 'copy' || ev.type === 'cut') {
      const ce = ev as ClipboardEvent
      const text = ce.clipboardData?.getData('text/plain') || ''
      base.clipboardLength = text.length
      base.clipboardPreview = clipText(text)
    }

    push(base)
  }

  const eventTypes: Array<keyof DocumentEventMap> = [
    'click',
    'dblclick',
    'mousedown',
    'mouseup',
    'keydown',
    'keyup',
    'beforeinput',
    'input',
    'change',
    'paste',
    'copy',
    'cut',
    'focusin',
    'focusout',
    'selectionchange',
  ]

  for (const t of eventTypes) {
    document.addEventListener(t, onAnyEvent, true)
  }

  return () => {
    for (const t of eventTypes) {
      document.removeEventListener(t, onAnyEvent, true)
    }
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer)
      flushTimer = null
    }
    flush()
  }
}
