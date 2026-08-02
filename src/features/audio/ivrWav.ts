/**
 * Getting a browser recording into a format the phone network can play.
 *
 * `<Play>` accepts exactly these MIME types: audio/mpeg, audio/wav (and its
 * two aliases), the three AIFF spellings, GSM and µ-law. That is the whole
 * list — https://www.twilio.com/docs/voice/twiml/play
 *
 * MediaRecorder produces none of them. Chrome and Android give webm/opus,
 * Safari gives mp4/AAC, and both were being uploaded as-is and written into
 * Play widgets, where Twilio would refuse to fetch them. So conversion is not
 * a nicety here; without it every take recorded in this app is silence on the
 * phone.
 *
 * 8 kHz mono is not required — Twilio will transcode a 44.1 kHz stereo WAV
 * quite happily — but it is what the phone network actually carries (G.711 is
 * 8 kHz), so doing it here avoids a transcode, and the files come out roughly
 * a tenth of the size, which matters both for Storage and for a PWA fetching
 * them over bad signal.
 */

export const IVR_SAMPLE_RATE = 8000
export const IVR_MIME = 'audio/wav'
export const IVR_EXT = 'wav'

/**
 * 16-bit PCM WAV, mono.
 *
 * Kept separate from the decoding so it can be tested without an audio device:
 * everything that can be got wrong here — the header, the byte order, the
 * clipping — is in this function.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([wavBytes(samples, sampleRate)], { type: IVR_MIME })
}

/** The bytes themselves, separated so the header can be checked without a
 *  Blob implementation — jsdom's has no way to read one back. */
export function wavBytes(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // format: uncompressed PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample over 1.0 would otherwise wrap around and
    // turn a loud moment into a burst of noise.
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buffer
}

/**
 * Anything the browser can decode, in; a phone-ready WAV, out.
 *
 * The decode is done by the browser's own audio stack, which handles every
 * format MediaRecorder produces as well as whatever an author drags in from
 * elsewhere. Rendering through an OfflineAudioContext at 8 kHz with one output
 * channel is what does the resampling and the downmix — writing either by hand
 * would be a worse version of what is already there.
 */
export async function toIvrWav(blob: Blob): Promise<{ blob: Blob; durationMs: number }> {
  const bytes = await blob.arrayBuffer()

  const Offline = window.OfflineAudioContext ?? window.webkitOfflineAudioContext
  const Ctx = window.AudioContext ?? window.webkitAudioContext
  if (!Offline || !Ctx) throw new Error('This browser cannot convert audio.')

  // Decoded at the device's own rate first: some browsers ignore the rate of
  // the context passed to decodeAudioData, so the resample is done explicitly
  // by the render below rather than assumed here.
  const decodeCtx = new Ctx()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(bytes)
  } finally {
    void decodeCtx.close()
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * IVR_SAMPLE_RATE))
  const offline = new Offline(1, frames, IVR_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()

  return {
    blob: encodeWav(rendered.getChannelData(0), IVR_SAMPLE_RATE),
    durationMs: Math.round(decoded.duration * 1000),
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
}
