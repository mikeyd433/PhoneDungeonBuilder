import { describe, expect, it } from 'vitest'
import { encodeWav, IVR_MIME, IVR_SAMPLE_RATE, wavBytes } from './ivrWav'

/**
 * The header is the part Twilio reads before deciding whether it can play the
 * file at all, so it is checked byte for byte rather than by round-tripping
 * through an audio stack the test environment does not have.
 */
const bytes = (samples: Float32Array) => new DataView(wavBytes(samples, IVR_SAMPLE_RATE))
const ascii = (v: DataView, at: number, len: number) =>
  String.fromCharCode(...Array.from({ length: len }, (_, i) => v.getUint8(at + i)))

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])

  it('writes a RIFF/WAVE header Twilio will accept', () => {
    const v = bytes(samples)
    expect(ascii(v, 0, 4)).toBe('RIFF')
    expect(ascii(v, 8, 4)).toBe('WAVE')
    expect(ascii(v, 12, 4)).toBe('fmt ')
    expect(ascii(v, 36, 4)).toBe('data')
  })

  it('declares uncompressed 16-bit mono PCM', () => {
    const v = bytes(samples)
    expect(v.getUint32(16, true)).toBe(16) // fmt chunk length
    expect(v.getUint16(20, true)).toBe(1) // 1 = PCM, uncompressed
    expect(v.getUint16(22, true)).toBe(1) // one channel
    expect(v.getUint16(34, true)).toBe(16) // bits per sample
  })

  it('states the rate, byte rate and block align consistently', () => {
    const v = bytes(samples)
    expect(v.getUint32(24, true)).toBe(8000)
    expect(v.getUint32(28, true)).toBe(8000 * 2) // mono, two bytes a frame
    expect(v.getUint16(32, true)).toBe(2)
  })

  it('sizes both length fields to the payload', () => {
    const v = bytes(samples)
    expect(v.getUint32(40, true)).toBe(samples.length * 2)
    expect(v.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(v.byteLength).toBe(44 + samples.length * 2)
  })

  it('writes little-endian samples, which is what RIFF means', () => {
    const v = bytes(new Float32Array([1]))
    expect(v.getInt16(44, true)).toBe(0x7fff)
    // Read the other way round it would be nonsense, which is the bug this
    // catches: a big-endian write produces a file that plays as static.
    expect(v.getInt16(44, false)).not.toBe(0x7fff)
  })

  it('clamps rather than wrapping, so a loud moment is not a burst of noise', () => {
    const v = bytes(new Float32Array([2, -2]))
    expect(v.getInt16(44, true)).toBe(0x7fff)
    expect(v.getInt16(46, true)).toBe(-0x8000)
  })

  it('maps silence to silence', () => {
    const v = bytes(new Float32Array([0, 0]))
    expect(v.getInt16(44, true)).toBe(0)
    expect(v.getInt16(46, true)).toBe(0)
  })

  it('labels the blob with a MIME type on Twilio’s list', () => {
    expect(encodeWav(samples, IVR_SAMPLE_RATE).type).toBe(IVR_MIME)
    // https://www.twilio.com/docs/voice/twiml/play — webm and m4a are not on it.
    expect(['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav']).toContain(IVR_MIME)
  })

  it('copes with an empty recording rather than producing a broken file', () => {
    const v = bytes(new Float32Array([]))
    expect(v.byteLength).toBe(44)
    expect(v.getUint32(40, true)).toBe(0)
  })
})
