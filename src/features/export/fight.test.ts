import { describe, expect, it } from 'vitest'
import { addCharacter, addFight, addLines, makeGraph, setOutcome } from '@/test/factory'
import { compileStory } from './compile'
import { castManifestCsv, printableScript } from './outputs'

/** Everything recorded — the shippable case, and the only one that emits play
 *  widgets now that nothing in the flow is spoken by Twilio. */
function sharkGraph() {
  const slugs = ['ENTRANCE', 'SHARKS', 'SHORE', 'DROWNED']
  const g = makeGraph(slugs, ['ENTRANCE>SHARKS'], { endings: ['DROWNED'], recorded: slugs })
  addFight(g, 'SHARKS', {
    moves: ['PUNCH beats Kick', 'KICK beats Block', 'BLOCK beats Punch'],
    rounds: ['Kick', 'Block', 'Punch'],
    win: 'SHORE',
    lose: 'DROWNED',
    recorded: true,
  })
  return g
}

const named = (widgets: Array<{ name: string }>) => widgets.map((w) => w.name)

describe('compiling a fight', () => {
  it('emits two widgets per round and no gather for the room', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const names = named(widgets)
    expect(names).toContain('SHARKS_r1_play')
    expect(names).toContain('SHARKS_r1_gather')
    expect(names).toContain('SHARKS_r3_gather')
    // The room's own gather would offer doors the fight overrides.
    expect(names).not.toContain('SHARKS_gather')
  })

  it('hands off from the room narration into round one, via the counter reset', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const play = widgets.find((w) => w.name === 'SHARKS_play')!
    // The reset zeroes the silence counters, so a fight re-entered by a loop
    // doesn't start already out of patience.
    expect(play.transitions[0].next).toBe('SHARKS_reset')
    const reset = widgets.find((w) => w.name === 'SHARKS_reset')!
    expect(reset.variables?.map((v) => v.key)).toEqual([
      'SHARKS_r1_silence',
      'SHARKS_r2_silence',
      'SHARKS_r3_silence',
    ])
    expect(reset.transitions[0].next).toBe('SHARKS_r1_play')
  })

  it('gives every move its own transition', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const gather = widgets.find((w) => w.name === 'SHARKS_r1_gather')!
    // Round one announces Kick, which PUNCH counters, and PUNCH is digit 1.
    // The other two digits are answers too — they just take the losing route.
    // `match` is what Studio evaluates; `condition` is the label beside it.
    expect(gather.transitions).toEqual([
      {
        event: 'keypress',
        condition: 'Digits equals 1',
        match: { type: 'equal_to', value: '1' },
        next: 'SHARKS_r2_play',
      },
      {
        event: 'keypress',
        condition: 'Digits equals 2',
        match: { type: 'equal_to', value: '2' },
        next: 'DROWNED_play',
      },
      {
        event: 'keypress',
        condition: 'Digits equals 3',
        match: { type: 'equal_to', value: '3' },
        next: 'DROWNED_play',
      },
      { event: 'noMatch', next: 'DROWNED_play' },
      // Silence is counted rather than punished — see the patience test below.
      { event: 'timeout', next: 'SHARKS_r1_waited' },
    ])
  })

  it('repeats a round on silence, then calls the fight', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const waited = widgets.find((w) => w.name === 'SHARKS_r1_waited')!
    expect(waited.variables).toEqual([
      { key: 'SHARKS_r1_silence', value: '{{ flow.variables.SHARKS_r1_silence | default: 0 | plus: 1 }}' },
    ])
    const patience = widgets.find((w) => w.name === 'SHARKS_r1_patience')!
    expect(patience.transitions).toEqual([
      {
        event: 'match',
        condition: 'Less than 3',
        match: { type: 'less_than', value: '3' },
        next: 'SHARKS_r1_play',
      },
      { event: 'noMatch', next: 'DROWNED_play' },
    ])
  })

  it('honours a fight’s own patience', () => {
    const slugs = ['SHARKS', 'SHORE', 'DROWNED']
    const g = makeGraph(slugs, [], { endings: ['DROWNED'], recorded: slugs })
    addFight(g, 'SHARKS', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Kick'],
      win: 'SHORE',
      lose: 'DROWNED',
      patience: 1,
      recorded: true,
    })
    const patience = compileStory(g, 'https://audio/').widgets.find(
      (w) => w.name === 'SHARKS_r1_patience',
    )!
    // Patience of 1 means the first silence calls it.
    expect(patience.transitions[0].condition).toBe('Less than 1')
  })

  it('sends the last round’s countering digit to the winning room', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const last = widgets.find((w) => w.name === 'SHARKS_r3_gather')!
    // Round three announces Punch, which BLOCK counters, and BLOCK is digit 3.
    expect(last.transitions.find((t) => t.condition === 'Digits equals 3')!.next).toBe('SHORE_play')
    expect(last.transitions.find((t) => t.condition === 'Digits equals 1')!.next).toBe(
      'DROWNED_play',
    )
  })

  it('sends every move to the same room when the round says so', () => {
    // The shape the counter rule cannot express: a beat that plays out the
    // same however the caller answers.
    const g = sharkGraph()
    for (const move of [0, 1, 2]) setOutcome(g, 'SHARKS', 0, move, 'SHORE')
    const gather = compileStory(g, 'https://audio/').widgets.find(
      (w) => w.name === 'SHARKS_r1_gather',
    )!
    const keypresses = gather.transitions.filter((t) => t.event === 'keypress')
    expect(keypresses).toHaveLength(3)
    expect(keypresses.every((t) => t.next === 'SHORE_play')).toBe(true)
  })

  it('warns when a round leads nowhere at all', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [], { recorded: ['A', 'WIN', 'LOSE'] })
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Headbutt'],
      win: 'WIN',
      recorded: true,
    })
    const { warnings, widgets } = compileStory(g, 'https://audio/')
    expect(warnings.join(' ')).toContain('nothing gets past this')
    // Emitted anyway, pointing back at the room, so the flow stays connected
    // and the warning is what tells the author it needs finishing.
    const gather = widgets.find((w) => w.name === 'A_r1_gather')!
    // Every digit, and an unmapped one, point back at the room; only the
    // silence counter goes anywhere else.
    expect(
      gather.transitions.filter((t) => t.event !== 'timeout').every((t) => t.next === 'A_play'),
    ).toBe(true)
  })

  it('says nothing rather than reading an unrecorded round aloud', () => {
    const slugs = ['SHARKS', 'SHORE', 'DROWNED']
    const g = makeGraph(slugs, [], { endings: ['DROWNED'], recorded: slugs })
    addFight(g, 'SHARKS', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Kick'],
      win: 'SHORE',
      lose: 'DROWNED',
    })
    const { warnings, widgets } = compileStory(g, 'https://audio/')
    expect(widgets.find((w) => w.name === 'SHARKS_r1_play')).toBeUndefined()
    // The reset skips the missing announcement and goes straight to the keypad.
    expect(widgets.find((w) => w.name === 'SHARKS_reset')!.transitions[0].next).toBe(
      'SHARKS_r1_gather',
    )
    expect(warnings.join(' ')).toContain('round 1 has no recording')
  })

  it('does not complain about several moves countering the same announcement', () => {
    // "Any of these gets you through" is a legitimate round, not a mistake.
    const slugs = ['A', 'WIN', 'LOSE']
    const g = makeGraph(slugs, [], { recorded: slugs })
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick', 'JAB beats Kick'],
      rounds: ['Kick'],
      win: 'WIN',
      lose: 'LOSE',
      recorded: true,
    })
    const { warnings, widgets } = compileStory(g, 'https://audio/')
    expect(warnings.filter((w) => w.startsWith('A:'))).toEqual([])
    const gather = widgets.find((w) => w.name === 'A_r1_gather')!
    expect(gather.transitions.filter((t) => t.next === 'WIN_play')).toHaveLength(2)
  })

  it('warns when a fight room also has doors', () => {
    const slugs = ['A', 'B', 'WIN', 'LOSE']
    const g = makeGraph(slugs, ['A>B'], { recorded: slugs })
    addFight(g, 'A', { moves: ['P beats K'], rounds: ['K'], win: 'WIN', lose: 'LOSE' })
    expect(compileStory(g, 'https://audio/').warnings.join(' ')).toContain('not exported')
  })
})

describe('scripts', () => {
  it('puts every fight digit in the printable script, not just the right one', () => {
    const script = printableScript(sharkGraph())
    expect(script).toContain('[fight: The shark]')
    expect(script).toContain('1 PUNCH → round 2')
    expect(script).toContain('2 KICK → DROWNED')
  })

  it('marks one actor’s lines and keeps everyone else’s as cues', () => {
    const g = makeGraph(['A'], [])
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addCharacter(g, 'MIKE', { name: 'Mike', voice_actor: 'Alex' })
    addLines(g, 'A', ['CARTER|get in', 'MIKE|not yet'])

    const sams = printableScript(g, 'Sam')
    expect(sams).toContain('> Carter: get in')
    expect(sams).toContain('  Mike: not yet')
  })

  it('leaves out rooms an actor does not appear in', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addLines(g, 'A', ['CARTER|get in'])
    const sams = printableScript(g, 'Sam')
    expect(sams).toContain('## A')
    expect(sams).not.toContain('## B')
  })

  it('counts rooms left to record per actor in the cast manifest', () => {
    const g = makeGraph(['A', 'B'], ['A>B'], { recorded: ['B'] })
    addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
    addLines(g, 'A', ['CARTER|one'])
    addLines(g, 'B', ['CARTER|two'])
    const csv = castManifestCsv(g)
    expect(csv.split('\n')[1]).toBe('"CARTER","Carter",no,"Sam",2,1')
  })
})
