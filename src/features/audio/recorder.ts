/**
 * Scratch VO capture (F3.1) via MediaRecorder, recorded in the browser on the
 * phone or tablet that's standing in the room.
 */

/** Codecs in preference order. Safari only landed MediaRecorder support late and
 *  still prefers mp4/AAC, so probing beats hard-coding webm. */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  '',
]

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of CANDIDATES) {
    if (type === '' || MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  return 'webm'
}

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

export interface Recording {
  blob: Blob
  mimeType: string
  durationMs: number
}

/**
 * A hold-to-record session.
 *
 * The stream's tracks are stopped explicitly on finish, not just on unmount —
 * leaving them live keeps the browser's recording indicator lit and holds the
 * microphone open, which on a phone is both alarming and a battery drain.
 */
export class RecorderSession {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.startedAt = performance.now()
    this.recorder.start()
  }

  get active(): boolean {
    return this.recorder?.state === 'recording'
  }

  stop(): Promise<Recording> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder
      if (!rec || rec.state === 'inactive') {
        this.release()
        reject(new Error('not recording'))
        return
      }
      rec.onstop = () => {
        const mimeType = rec.mimeType || pickMimeType() || 'audio/webm'
        const blob = new Blob(this.chunks, { type: mimeType })
        const durationMs = Math.round(performance.now() - this.startedAt)
        this.release()
        resolve({ blob, mimeType, durationMs })
      }
      rec.onerror = () => {
        this.release()
        reject(new Error('recording failed'))
      }
      rec.stop()
    })
  }

  /** Abandon a take without producing a recording. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.release()
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}

/**
 * Measure a clip's real duration by decoding it.
 *
 * MediaRecorder's wall-clock elapsed time is close but not exact, and for webm
 * the `duration` on an HTMLAudioElement is frequently `Infinity` until the file
 * is fully seeked. Decoding is the only reliable source, and the number matters:
 * it feeds the audio manifest and the 15-second warning.
 */
export async function measureDuration(blob: Blob, fallbackMs: number): Promise<number> {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return fallbackMs
    const ctx = new Ctx()
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    const ms = Math.round(buffer.duration * 1000)
    void ctx.close()
    return ms > 0 ? ms : fallbackMs
  } catch {
    return fallbackMs
  }
}

/**
 * Reduce a clip to N peak amplitudes for the waveform scrubber (F3.2).
 * Peak rather than mean, because mean-averaging flattens speech into a
 * featureless bar and the whole point is seeing where the words are.
 */
export async function computePeaks(blob: Blob, buckets = 96): Promise<number[]> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return []
  const ctx = new Ctx()
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = buffer.getChannelData(0)
    const size = Math.floor(data.length / buckets) || 1
    const peaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let peak = 0
      const start = i * size
      for (let j = start; j < start + size && j < data.length; j++) {
        const v = Math.abs(data[j])
        if (v > peak) peak = v
      }
      peaks.push(peak)
    }
    const max = Math.max(...peaks, 0.01)
    return peaks.map((p) => p / max) // normalise so quiet takes still read
  } catch {
    return []
  } finally {
    void ctx.close()
  }
}
