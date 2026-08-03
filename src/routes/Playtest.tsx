import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { PlaytestEngine, type PlaytestState } from '@/features/playtest/engine'
import { publicAudioUrl } from '@/features/audio/storage'
import { DIGITS } from '@/types/domain'
import { playbackFor } from '@/features/cast/dialogue'

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
  /** True while the room is still reading itself out. */
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  const engine = useMemo(() => (graph ? new PlaytestEngine(graph) : null), [graph])
  const node = state && graph ? graph.nodes.get(state.nodeId) : null

  /**
   * Speak a line, and call `done` when it has finished.
   *
   * F5.2 — browser TTS stands in wherever audio hasn't been recorded, so a
   * story can be playtested long before anyone books a session. REHEARSAL ONLY:
   * the exported flow never speaks, and anything unrecorded is silence on the
   * phone. This exists so a writer can hear the shape of a scene, not so an
   * unfinished story sounds finished.
   *
   * The completion callback is the whole point. Without it the caller has no
   * way to know an utterance has ended, so a scene of several unrecorded lines
   * would start them all at once — and since `cancel()` runs before each one,
   * only the last would actually be heard. `done` fires on error and when TTS
   * is switched off too, so the sequence never stalls.
   */
  const speakThen = useCallback(
    (text: string, done: () => void) => {
      if (!ttsOn || !text || typeof speechSynthesis === 'undefined') {
        done()
        return
      }
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95
      u.onend = done
      u.onerror = done
      speechSynthesis.speak(u)
    },
    [ttsOn],
  )

  const speak = useCallback((text: string) => speakThen(text, () => {}), [speakThen])

  /**
   * What a room reads out, as transcript lines.
   *
   * A room recorded as one file is one line, as it always was. A room whose
   * lines carry their own takes reads them one after another, with the speaker
   * named — the conversation plays out, and only then are the exits offered.
   */
  const roomLines = useCallback(
    (nodeId: string, slug: string): Line[] => {
      if (!graph) return []
      const parts = playbackFor(graph, nodeId)
      const written = parts.filter((p) => p.say.trim())
      if (written.length === 0) return [{ who: 'story', text: `(${slug} has no script yet)` }]
      return written.map((p) => ({
        who: 'story',
        text: p.speaker ? `${p.speaker}: ${p.say}` : p.say,
      }))
    },
    [graph],
  )

  const begin = useCallback(() => {
    if (!engine || !graph) return
    speechSynthesis?.cancel?.()
    const start = engine.start()
    setState(start)
    const first = graph.nodes.get(start.nodeId)
    const opening: Line[] = first ? roomLines(first.id, first.slug) : []
    // A fight room reads its lead-in, then the first round.
    const round = engine.roundPrompt(start)
    if (round) opening.push({ who: 'story', text: round })
    setLines(opening)
  }, [engine, graph, roomLines])

  useEffect(() => {
    if (engine && !state) begin()
  }, [engine, state, begin])

  // Play the room: real audio where it exists, TTS where it doesn't. A room
  // recorded line by line plays its takes back to back, so a conversation
  // between two separately-booked actors sounds on the playtest the way it will
  // sound on the phone rather than as one voice reading both parts.
  //
  // Strictly one part at a time. Recorded parts chain on the audio element's
  // `ended`; spoken ones chain on the utterance's `onend`. Advancing without
  // waiting — which is what this used to do for spoken parts — meant the next
  // part cancelled the previous one mid-sentence, so in a mixed scene only a
  // trailing unrecorded line was ever heard.
  useEffect(() => {
    if (!node || !graph) return
    const parts = playbackFor(graph, node.id)
    let cancelled = false
    let index = 0
    setPlaying(parts.length > 0)

    const el = audioRef.current
    const playNext = () => {
      if (cancelled) return
      if (index >= parts.length) {
        setPlaying(false)
        return
      }
      const part = parts[index++]
      if (part.audioPath && el) {
        speechSynthesis?.cancel?.()
        el.src = publicAudioUrl(part.audioPath)
        // A file that won't load falls back to being spoken, so one broken
        // upload doesn't silently swallow a line of the scene.
        void el.play().catch(() => speakThen(part.say, playNext))
        return
      }
      speakThen(part.say, playNext)
    }

    if (el) el.onended = playNext
    playNext()

    return () => {
      cancelled = true
      if (el) el.onended = null
      speechSynthesis?.cancel?.()
    }
  }, [node, graph, speakThen])

  // F5.4 — the timeout branch fires if the caller says nothing in time.
  //
  // The clock starts when the room has finished speaking, not when the caller
  // walks in. Studio's gather runs after its play widget, so a 30-second scene
  // with a 5-second timeout does NOT time out mid-narration on the phone — and
  // a playtest that did would make long scenes impossible to test.
  useEffect(() => {
    if (!state || !node || state.finished || !engine || playing) return
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
  }, [state, node, engine, playing])

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
      added.push(...roomLines(movedTo.id, movedTo.slug))
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
        {/* Both hang up, but the caller is meant to be able to tell which one
            they got — and so is whoever is rehearsing the story. */}
        {state.finished &&
          ((node?.ending_kind ?? 'death') === 'win' ? (
            <p className="mt-6 font-carved uppercase tracking-[0.12em] text-torch">
              ☀ You got out. The line goes quiet.
            </p>
          ) : (
            <p className="mt-6 font-carved uppercase tracking-[0.12em] text-grave">
              ☠ The line goes dead.
            </p>
          ))}
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
            title={
              graph.story.inventory_key === d
                ? 'Hear what you are carrying, then carry on'
                : undefined
            }
            className={[
              'bg-black py-4 font-carved text-lg active:bg-stone disabled:opacity-30',
              // The reserved key does the same thing in every room, so it is
              // marked rather than left to be discovered.
              graph.story.inventory_key === d ? 'text-torch' : 'text-parchment',
            ].join(' ')}
          >
            {d}
            {graph.story.inventory_key === d && <span className="ml-1 text-xs">🎒</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ttsOn} onChange={(e) => setTtsOn(e.target.checked)} />
          {/* A rehearsal aid only. The exported flow never speaks — anything
              unrecorded is silence on the phone. */}
          Read unrecorded lines aloud (playtest only)
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
