import { describe, expect, it } from 'vitest'
import {
  composeNarration,
  matchCharacter,
  splitNarration,
  suggestCast,
  workloads,
} from './dialogue'
import { addCharacter, addLines, makeGraph } from '@/test/factory'

describe('splitNarration', () => {
  it('splits a leading speaker off each line', () => {
    expect(splitNarration('Carter: run\nMike: no')).toEqual([
      { speaker: 'Carter', text: 'run' },
      { speaker: 'Mike', text: 'no' },
    ])
  })

  it('leaves unattributed narration alone', () => {
    expect(splitNarration('The hull groans.')).toEqual([
      { speaker: null, text: 'The hull groans.' },
    ])
  })

  it('splits an inline speaker after a sentence ends', () => {
    expect(splitNarration('The door opens. Carter: get in.')).toEqual([
      { speaker: null, text: 'The door opens.' },
      { speaker: 'Carter', text: 'get in.' },
    ])
  })

  it('does not tear a clause apart mid-sentence', () => {
    // No sentence-ending punctuation before the name, so this stays one line.
    const [line] = splitNarration('and then, Carter: run')
    expect(line).toEqual({ speaker: null, text: 'and then, Carter: run' })
  })

  it('takes a two-word name but not a sentence', () => {
    expect(splitNarration('Big Mike: hello')[0].speaker).toBe('Big Mike')
    expect(
      splitNarration('The thing about the shark is this: it is enormous')[0].speaker,
    ).toBeNull()
  })

  it('leaves production directions unattributed but intact', () => {
    // A voice actor still needs to read "SFX: …"; they just aren't cast as SFX.
    expect(splitNarration('SFX: a door slams')).toEqual([
      { speaker: null, text: 'SFX: a door slams' },
    ])
  })

  it('ignores a colon with nothing after it', () => {
    expect(splitNarration('Carter:')[0].speaker).toBeNull()
  })

  it('drops blank lines', () => {
    expect(splitNarration('Carter: one\n\n\nMike: two')).toHaveLength(2)
  })

  it('returns nothing for empty narration', () => {
    expect(splitNarration('   ')).toEqual([])
  })
})

describe('composeNarration', () => {
  it('is the inverse of splitNarration', () => {
    const text = 'The hull groans.\nCarter: get in.\nMike: not yet.'
    expect(composeNarration(splitNarration(text))).toBe(text)
  })

  it('round-trips text an author typed inline', () => {
    // Composing normalises the inline form to one line per speaker, and
    // splitting that again has to be stable — otherwise every save would
    // reshuffle the script.
    const once = composeNarration(splitNarration('It opens. Carter: get in.'))
    expect(composeNarration(splitNarration(once))).toBe(once)
  })

  it('drops empty lines rather than leaving blank prefixes', () => {
    expect(composeNarration([{ speaker: 'Carter', text: '  ' }, { speaker: null, text: 'x' }])).toBe(
      'x',
    )
  })
})

describe('cast helpers', () => {
  it('matches a name case-insensitively, by name or slug', () => {
    const g = makeGraph(['A'], [])
    addCharacter(g, 'CARTER', { name: 'Carter' })
    expect(matchCharacter(g, 'carter')?.slug).toBe('CARTER')
    expect(matchCharacter(g, 'CARTER')?.slug).toBe('CARTER')
    expect(matchCharacter(g, 'Mike')).toBeNull()
  })

  it('suggests speakers found in the script but not in the cast', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const a = [...g.nodes.values()][0]
    const b = [...g.nodes.values()][1]
    g.nodes.set(a.id, { ...a, narration: 'Carter: one\nMike: two' })
    g.nodes.set(b.id, { ...b, narration: 'Carter: three' })
    addCharacter(g, 'MIKE', { name: 'Mike' })

    const found = suggestCast(g)
    expect(found.map((f) => f.name)).toEqual(['Carter'])
    expect(found[0].lines).toBe(2)
    expect(found[0].sampleSlugs).toEqual(['A', 'B'])
  })

  it('counts an actor’s queue in rooms, not lines', () => {
    // Two lines in one unrecorded room is one room to book, not two.
    const g = makeGraph(['A', 'B'], ['A>B'], { recorded: ['B'] })
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addLines(g, 'A', ['CARTER|one', 'CARTER|two'])
    addLines(g, 'B', ['CARTER|three'])

    const [sam] = workloads(g)
    expect(sam.actor).toBe('Sam')
    expect(sam.lines).toBe(3)
    expect(sam.unrecordedSlugs).toEqual(['A'])
  })

  it('counts a one-file room as outstanding for everyone in it', () => {
    // Nobody can book their half of a scene that records as a single take.
    const g = makeGraph(['A'], [])
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addCharacter(g, 'MIKE', { name: 'Mike', voice_actor: 'Alex' })
    addLines(g, 'A', ['CARTER|one', 'MIKE|two'])

    for (const q of workloads(g)) {
      expect(q.unrecordedSlugs).toEqual(['A'])
      expect(q.unrecordedLines).toBe(0)
    }
  })

  it('counts a line-by-line room only for the actors still missing takes', () => {
    const g = makeGraph(['A'], [])
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addCharacter(g, 'MIKE', { name: 'Mike', voice_actor: 'Alex' })
    const [carters] = addLines(g, 'A', ['CARTER|one', 'MIKE|two'], { recorded: true })
    // Alex's line has a take; Sam's is pulled, so only Sam owes anything.
    g.dialogue.set(carters.id, { ...carters, audio_path: null, audio_duration_ms: null })

    const byActor = new Map(workloads(g).map((q) => [q.actor, q]))
    expect(byActor.get('Sam')!.unrecordedSlugs).toEqual(['A'])
    expect(byActor.get('Sam')!.unrecordedLines).toBe(1)
    expect(byActor.get('Alex')!.unrecordedSlugs).toEqual([])
  })

  it('groups lines with no voice actor separately, and last', () => {
    const g = makeGraph(['A'], [])
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addCharacter(g, 'VOICE', { name: 'Voice' })
    addLines(g, 'A', ['CARTER|one', 'VOICE|two'])

    const queues = workloads(g)
    expect(queues.map((q) => q.actor)).toEqual(['Sam', null])
  })
})
