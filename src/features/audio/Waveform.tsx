import { useEffect, useRef, useState } from 'react'

/**
 * F3.2 — inline playback with a waveform scrubber.
 *
 * Peaks are drawn as bars in torch amber up to the playhead and cold beyond it,
 * so the played portion reads the same way a lit room does. Clicking or dragging
 * anywhere on the bar seeks.
 */
export default function Waveform({ peaks, src }: { peaks: number[]; src: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setPlaying(false)
    setProgress(0)
  }, [src])

  const seek = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const a = audio.current
    if (a && Number.isFinite(a.duration)) a.currentTime = ratio * a.duration
    setProgress(ratio)
  }

  // A clip with no decodable peaks (or a browser without AudioContext) still
  // gets a usable scrubber — a flat bar is better than no control.
  const bars = peaks.length > 0 ? peaks : Array.from({ length: 48 }, () => 0.35)

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => {
          const a = audio.current
          if (!a) return
          if (a.paused) void a.play()
          else a.pause()
        }}
        aria-label={playing ? 'Pause' : 'Play'}
        className="shrink-0 rounded border border-mortar px-3 py-2 hover:border-torch"
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(e.clientX, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) seek(e.clientX, e.currentTarget)
        }}
        onKeyDown={(e) => {
          const a = audio.current
          if (!a || !Number.isFinite(a.duration)) return
          if (e.key === 'ArrowRight') a.currentTime = Math.min(a.duration, a.currentTime + 1)
          if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 1)
        }}
        className="flex h-12 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden rounded bg-depth/60 px-1"
      >
        {bars.map((p, i) => {
          const played = i / bars.length <= progress
          return (
            <span
              key={i}
              style={{ height: `${Math.max(8, p * 100)}%` }}
              className={['w-full rounded-sm', played ? 'bg-torch' : 'bg-cold'].join(' ')}
            />
          )
        })}
      </div>

      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget
          if (Number.isFinite(a.duration) && a.duration > 0) {
            setProgress(a.currentTime / a.duration)
          }
        }}
      />
    </div>
  )
}
