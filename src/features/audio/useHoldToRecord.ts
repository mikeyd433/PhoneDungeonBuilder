import { useRef, useState } from 'react'

/**
 * Hold to record, without recording every time you scroll past the button.
 *
 * The naive version — start on pointerdown, stop on pointerup or pointerleave —
 * turns a flick of the thumb into a take: the finger lands on the button, the
 * page scrolls, the pointer leaves, and a fragment of room noise is uploaded
 * over whatever was there. On a phone, where the editor sheet is a long scroll
 * and the record button is in the middle of it, that is not an edge case.
 *
 * So a press has to mean it: held still for a moment, and not dragged. Both
 * conditions are what distinguishes a deliberate press from a scroll that
 * happened to begin on a button.
 */

/** How long a finger must rest before it counts as a press, in ms. */
const HOLD_DELAY = 220
/** How far it may travel in that time, in px. */
const SLOP = 10

export interface HoldToRecord {
  recording: boolean
  /** Spread onto the button. */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: () => void
    onPointerLeave: () => void
    onPointerCancel: () => void
  }
}

export function useHoldToRecord(
  start: () => Promise<void> | void,
  stop: () => Promise<void> | void,
): HoldToRecord {
  const [recording, setRecording] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const from = useRef<{ x: number; y: number } | null>(null)
  // A ref as well as state: the pointerup handler runs before React has
  // re-rendered, and it has to know whether recording actually began.
  const live = useRef(false)

  const abandon = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }

  const finish = () => {
    abandon()
    if (!live.current) return
    live.current = false
    setRecording(false)
    void stop()
  }

  return {
    recording,
    handlers: {
      onPointerDown: (e) => {
        from.current = { x: e.clientX, y: e.clientY }
        timer.current = setTimeout(() => {
          timer.current = null
          live.current = true
          setRecording(true)
          void start()
        }, HOLD_DELAY)
      },
      onPointerMove: (e) => {
        // Only while waiting: once recording has begun, moving the finger is
        // just holding it, and cutting the take there would be worse.
        if (!from.current || live.current) return
        const dx = e.clientX - from.current.x
        const dy = e.clientY - from.current.y
        if (Math.hypot(dx, dy) > SLOP) abandon()
      },
      onPointerUp: finish,
      onPointerLeave: finish,
      // The browser taking the gesture over for a scroll: never a take.
      onPointerCancel: () => {
        abandon()
        if (!live.current) return
        live.current = false
        setRecording(false)
        void stop()
      },
    },
  }
}
