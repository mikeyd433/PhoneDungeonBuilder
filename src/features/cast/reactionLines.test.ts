import { describe, expect, it } from 'vitest'
import { linesOf, ownerKey, reactionPlaybackFor, splitsByLine, workloads } from './dialogue'
import { buildRoomView } from '@/features/room/roomModel'
import { deriveGraph } from '@/features/graph/derived'
import { compileStory } from '@/features/export/compile'
import { audioTargets, matchFile } from '@/features/audio/targets'
import { PlaytestEngine } from '@/features/playtest/engine'
import { addCharacter, addReactionLines, choiceOf, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

const BASE = 'https://audio.example/'

/** A hall, a cave, and the door between them carrying a reaction. */
function doorway(opts: { recorded?: boolean; wholeTake?: boolean } = {}) {
  const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'], { recorded: ['HALL', 'CAVE'] })
  const id = choiceOf(g, 'HALL', 'CAVE')
  g.choices.set(id, {
    ...g.choices.get(id)!,
    reaction_narration: 'CARTER: don’t touch it.\nMIKE: too late.',
    audio_path: opts.wholeTake === false ? null : 'takes/whole-thing.mp3',
  })
  addCharacter(g, 'carter', { name: 'Carter' })
  addCharacter(g, 'mike', { name: 'Mike' })
  addReactionLines(g, id, ['carter|don’t touch it.', 'mike|too late.'], opts)
  return { g, id }
}

describe('a reaction split by speaker', () => {
  it('keeps its lines apart from a room’s', () => {
    const { g, id } = doorway()
    expect(linesOf(g, { choiceId: id }).map((l) => l.text)).toEqual([
      'don’t touch it.',
      'too late.',
    ])
    expect(linesOf(g, { nodeId: idOf(g, 'HALL') })).toEqual([])
    expect(ownerKey({ choiceId: id })).not.toBe(ownerKey({ nodeId: id }))
  })

  /**
   * The switch that makes the whole thing worth having: two actors booked
   * separately can each read their half, and the door stops being one file.
   */
  it('plays its lines once they carry takes, not the door’s own file', () => {
    const { g, id } = doorway({ recorded: true })
    expect(splitsByLine(g, { choiceId: id })).toBe(true)
    const parts = reactionPlaybackFor(g, id)
    expect(parts.map((p) => p.speaker)).toEqual(['Carter', 'Mike'])
    expect(parts.every((p) => p.audioPath?.startsWith('audio/react-'))).toBe(true)
  })

  it('is still one file until a line is recorded', () => {
    const { g, id } = doorway()
    expect(splitsByLine(g, { choiceId: id })).toBe(false)
    expect(reactionPlaybackFor(g, id)).toEqual([
      expect.objectContaining({ audioPath: 'takes/whole-thing.mp3', speaker: null }),
    ])
  })
})

describe('exporting a split reaction', () => {
  const widgets = (g: StoryGraph) => compileStory(g, BASE).widgets
  const byName = (g: StoryGraph, name: string) => widgets(g).find((w) => w.name === name)

  it('is one widget per line, chained, landing where the door goes', () => {
    const { g } = doorway({ recorded: true })
    const keys = byName(g, 'HALL_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('HALL_d1_react')
    expect(byName(g, 'HALL_d1_react')!.transitions[0].next).toBe('HALL_d1_react_line2')
    expect(byName(g, 'HALL_d1_react_line2')!.transitions[0].next).toBe('CAVE_play')
  })

  it('names who is speaking on each, so the flow can be read', () => {
    const { g } = doorway({ recorded: true })
    expect(byName(g, 'HALL_d1_react')!.note).toContain('Carter')
    expect(byName(g, 'HALL_d1_react_line2')!.note).toContain('Mike')
  })

  /**
   * The one that would ship as a lie: the door has a take of the whole
   * exchange, but what it PLAYS is its lines — so a half-recorded two-hander
   * must not be exported as if the old file still covered it.
   */
  it('skips an unrecorded line and reports how many', () => {
    const { g, id } = doorway()
    const lines = linesOf(g, { choiceId: id })
    g.dialogue.set(lines[0].id, { ...lines[0], audio_path: 'audio/carter.mp3' })
    const r = compileStory(g, BASE)

    expect(r.widgets.find((w) => w.name === 'HALL_d1_react')!.playUrl).toBe(
      `${BASE}audio/carter.mp3`,
    )
    expect(r.widgets.find((w) => w.name === 'HALL_d1_react_line2')).toBeUndefined()
    // The one that IS recorded still hands over to the next room.
    expect(r.widgets.find((w) => w.name === 'HALL_d1_react')!.transitions[0].next).toBe('CAVE_play')
    expect(
      r.warnings.some((w) => w.includes('1 of its 2 lines have no take')),
    ).toBe(true)
  })

  it('lands on widgets that exist, like everything else', () => {
    const { g } = doorway({ recorded: true })
    const r = compileStory(g, BASE)
    const present = new Set(r.widgets.map((w) => w.name))
    for (const w of r.widgets) {
      for (const t of w.transitions) {
        if (t.next) expect(present, `${w.name} -> ${t.next}`).toContain(t.next)
      }
    }
  })
})

describe('recording a split reaction', () => {
  it('asks for one file per line, named for the door it happens in', () => {
    const { g } = doorway()
    const files = audioTargets(g)
      .filter((t) => t.file.includes('__react'))
      .map((t) => t.file)
    expect(files).toEqual(['HALL__d1__react__line1', 'HALL__d1__react__line2'])
  })

  it('stops asking for the door’s own file once it is split', () => {
    const { g } = doorway()
    expect(audioTargets(g).some((t) => t.kind === 'reaction')).toBe(false)
  })

  it('matches a file back to the right line', () => {
    const { g, id } = doorway()
    const hit = matchFile(audioTargets(g), 'HALL__d1__react__line2 take 3.wav')
    expect(hit?.ref).toEqual({ kind: 'line', lineId: linesOf(g, { choiceId: id })[1].id })
  })

  it('says who each line is for, so a session can be booked from it', () => {
    const { g } = doorway()
    const labels = audioTargets(g)
      .filter((t) => t.file.includes('__react'))
      .map((t) => t.label)
    expect(labels[0]).toContain('Carter')
    expect(labels[1]).toContain('Mike')
  })
})

describe('a split reaction elsewhere in the app', () => {
  it('is spoken with its speakers in the playtest', () => {
    const { g } = doorway({ recorded: true })
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const { spoken } = engine.press(start, '1')
    expect(spoken).toContain('Carter: don’t touch it.')
    expect(spoken).toContain('Mike: too late.')
  })

  it('flags the unrecorded half rather than reading it as though it ships', () => {
    const { g, id } = doorway()
    const lines = linesOf(g, { choiceId: id })
    g.dialogue.set(lines[0].id, { ...lines[0], audio_path: 'audio/carter.mp3' })
    const engine = new PlaytestEngine(g)
    const { spoken } = engine.press(engine.start(), '1')
    // Carter has been read; Mike has not, and on the phone that half is silence.
    expect(spoken).toContain('Carter: don’t touch it.\n')
    expect(spoken).toContain('Mike: too late. (no recording')
  })

  /** The door's icon is red until every part of it has been read. */
  it('counts as recorded only when every line has a take', () => {
    const half = doorway()
    const lines = linesOf(half.g, { choiceId: half.id })
    half.g.dialogue.set(lines[0].id, { ...lines[0], audio_path: 'audio/carter.mp3' })
    const exitOf = (g: StoryGraph) =>
      buildRoomView(g, deriveGraph(g), idOf(g, 'HALL'))!.exits.find((e) => e.digit === '1')!

    expect(exitOf(half.g).reaction).toBe('written')
    expect(exitOf(doorway({ recorded: true }).g).reaction).toBe('recorded')
    expect(exitOf(makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])).reaction).toBe('none')
  })

  it('sends an actor back to the room the doorway is in', () => {
    const { g } = doorway({ wholeTake: false })
    const carter = workloads(g).find((w) => w.characters.includes('Carter'))!
    expect(carter.unrecordedSlugs).toEqual(['HALL (pressing 1)'])
  })
})
