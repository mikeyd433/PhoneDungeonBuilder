import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { PlaytestEngine, type PlaytestState } from '@/features/playtest/engine'
import { publicAudioUrl } from '@/features/audio/storage'
import { DIGITS } from '@/types/domain'

interface Line {
  who: 'story' | 'caller'
  text: string
}

/**
 * §4.4 "Dial in" — the same data, as the caller experiences it. Black screen, a
 * numeric keypad, a transcript that scrolls.
 */
export default function Playtest() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, loadStory } = useDelve()
  const [state, setState] = useState<PlaytestState | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [ttsOn, setTtsOn] = useState(true)
  const [showOverride, setShowOverride] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  const engine = useMemo(() => (graph ? new PlaytestEngine(graph) : null), [graph])
  const node = state && graph ? graph.nodes.get(state.nodeId) : null

  const speak = useCallback(
    (text: string) => {
      // F5.2 — browser TTS stands in wherever audio hasn't been recorded, so a
      // story can be playtested long before anyone books a session.
      if (!ttsOn || !text || typeof speechSynthesis === 'undefined') return
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95
      speechSynthesis.speak(u)
    },
    [ttsOn],
  )

  const begin = useCallback(() => {
    if (!engine || !graph) return
    speechSynthesis?.cancel?.()
    const start = engine.start()
    setState(start)
    const first = graph.nodes.get(start.nodeId)
    const opening: Line[] = first
      ? [{ who: 'story', text: first.narration || `(${first.slug} has no script yet)` }]
      : []
    // A fight room reads its lead-in, then the first round.
    const round = engine.roundPrompt(start)
    if (round) opening.push({ who: 'story', text: round })
    setLines(opening)
  }, [engine, graph])

  useEffect(() => {
    if (engine && !state) begin()
  }, [engine, state, begin])

  // Play the room: real audio where it exists, TTS where it doesn't.
  useEffect(() => {
    if (!node) return
    if (node.audio_path) {
      speechSynthesis?.cancel?.()
      const el = audioRef.current
      if (el) {
        el.src = publicAudioUrl(node.audio_path)
        void el.play().catch(() => speak(node.narration))
      }
    } else {
      speak(node.narration)
    }
  }, [node, speak])

  // F5.4 — the timeout branch fires if the caller says nothing in time.
  useEffect(() => {
    if (!state || !node || state.finished || !engine) return
    setSecondsLeft(node.timeout_seconds)
    const tick = window.setInterval(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000)
    const fire = window.setTimeout(() => {
      const { next, spoken } = engine.timeout(state)
      pushTurn('(said nothing)', next, spoken, 'timed out')
    }, node.timeout_seconds * 1000)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(fire)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, node, engine])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  function pushTurn(
    callerText: string,
    next: PlaytestState,
    spoken: string | null,
    _why?: string,
  ) {
    if (!graph) return
    const added: Line[] = [{ who: 'caller', text: callerText }]
    if (spoken) added.push({ who: 'story', text: spoken })
    const movedTo = next.nodeId !== state?.nodeId ? graph.nodes.get(next.nodeId) : null
    if (movedTo) {
      added.push({ who: 'story', text: movedTo.narration || `(${movedTo.slug} has no script yet)` })
      // Walking into a fight: its first round follows the room's lead-in.
      const opening = engine?.roundPrompt(next)
      if (opening) added.push({ who: 'story', text: opening })
    }
    if (spoken && !movedTo) speak(spoken)
    setLines((l) => [...l, ...added])
    setState(next)
  }

  if (!graph || !engine || !state) return <p className="p-6 text-mortar">Dialling…</p>

  const offered = engine.offered(state)
  const fightOptions = engine.fightOptions(state)
  const held = engine.held(state)
  const vars = [...graph.stateVars.values()]

  return (
    <main className="flex h-[100dvh] flex-col bg-black text-parchment">
      <header className="flex items-center justify-between border-b border-mortar/40 px-4 py-3 text-sm">
        <Link to={`/story/${storyId}`} className="text-mortar underline">
          ◄ Hang up
        </Link>
        <span className="font-paper text-torch">{node?.slug}</span>
        <button onClick={begin} className="text-mortar underline">
          Redial
        </button>
      </header>

      {/* F5.3 — live inventory. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-mortar/30 px-4 py-2 text-xs">
        {held.length === 0 ? (
          <span className="text-cold">carrying nothing</span>
        ) : (
          held.map((h) => (
            <span key={h} className="rounded bg-torch/20 px-2 py-1 text-torch">
              {h}
            </span>
          ))
        )}
        {vars.length > 0 && (
          <button
            onClick={() => setShowOverride((v) => !v)}
            className="ml-auto text-mortar underline"
          >
            {/* F8.12 — force state to test a late gate without replaying. */}
            set state
          </button>
        )}
      </div>

      {showOverride && (
        <div className="flex flex-wrap gap-2 border-b border-mortar/30 px-4 py-2 text-xs">
          {vars.map((v) => {
            const on = held.some((h) => h === v.slug || h.startsWith(`${v.slug} ×`))
            return (
              <button
                key={v.id}
                onClick={() => {
                  const bit = engine.index.bit.get(v.slug)
                  const slot = engine.index.counter.get(v.slug)
                  const caller = { ...state.caller, counters: [...state.caller.counters] }
                  if (bit !== undefined) caller.mask ^= 1 << bit
                  else if (slot !== undefined) caller.counters[slot] = on ? 0 : 1
                  setState({ ...state, caller })
                }}
                className={[
                  'rounded border px-2 py-1',
                  on ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
                ].join(' ')}
              >
                {v.slug}
              </button>
            )
          })}
        </div>
      )}

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {lines.map((line, i) => (
          <p
            key={i}
            className={[
              'mb-3 max-w-prose text-lg leading-relaxed',
              line.who === 'caller' ? 'text-right text-sm text-cold' : 'text-parchment',
            ].join(' ')}
          >
            {line.text}
          </p>
        ))}
        {state.finished && (
          <p className="mt-6 font-carved uppercase tracking-[0.12em] text-grave">
            ☠ The line goes dead.
          </p>
        )}
      </div>

      {!state.finished && (
        <div className="border-t border-mortar/40 px-4 py-2 text-xs text-mortar">
          {state.fightRound !== null ? (
            /* Mid-fight the digits mean moves, not doors. Every other answer
               loses, which is why they are listed as the only ones. */
            <>
              <span className="mr-3 text-grave">
                round {state.fightRound + 1} of {engine.fightAt(state)?.rounds.length ?? 0}
              </span>
              {fightOptions.map((o) => (
                <span key={o.digit} className="mr-3">
                  <span className="text-torch">{o.digit}</span> {o.label}
                </span>
              ))}
              {fightOptions.length === 0 && (
                <span className="text-grave">This fight has no moves — every answer loses.</span>
              )}
            </>
          ) : offered.length === 0 ? (
            <span className="text-grave">
              No exits here and this isn&apos;t an ending — the caller is stuck.
            </span>
          ) : (
            <>
              {offered.map((o) => (
                <span key={o.choice.id} className="mr-3">
                  <span className="text-torch">{o.choice.digit}</span> {o.label || '(no label)'}
                </span>
              ))}
              {secondsLeft !== null && secondsLeft >= 0 && (
                <span className="float-right">{secondsLeft}s</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Keypad, in phone order. */}
      <div className="grid grid-cols-3 gap-px bg-mortar/30 p-px">
        {DIGITS.map((d) => (
          <button
            key={d}
            disabled={state.finished}
            onClick={() => {
              const { next, spoken } = engine.press(state, d)
              pushTurn(`pressed ${d}`, next, spoken)
            }}
            className="bg-black py-4 font-carved text-lg text-parchment active:bg-stone disabled:opacity-30"
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ttsOn} onChange={(e) => setTtsOn(e.target.checked)} />
          Read unrecorded rooms aloud
        </label>
        {/* F5.6 — hand a specific route to a VO performer. */}
        <button
          onClick={() => {
            const blob = new Blob([state.path.join('\n')], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${graph.story.title}-path.txt`
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="text-mortar underline"
        >
          Export path ({state.path.length})
        </button>
      </div>

      <audio ref={audioRef} hidden />
    </main>
  )
}
