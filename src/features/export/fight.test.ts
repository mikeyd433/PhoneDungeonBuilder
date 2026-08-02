import { describe, expect, it } from 'vitest'
import { addCharacter, addFight, addLines, makeGraph } from '@/test/factory'
import { compileStory } from './compile'
import { castManifestCsv, printableScript } from './outputs'

function sharkGraph() {
  const g = makeGraph(['ENTRANCE', 'SHARKS', 'SHORE', 'DROWNED'], ['ENTRANCE>SHARKS'], {
    endings: ['DROWNED'],
  })
  addFight(g, 'SHARKS', {
    moves: ['PUNCH beats Kick', 'KICK beats Block', 'BLOCK beats Punch'],
    rounds: ['Kick', 'Block', 'Punch'],
    win: 'SHORE',
    lose: 'DROWNED',
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

  it('hands off from the room narration into round one', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const play = widgets.find((w) => w.name === 'SHARKS_play')!
    expect(play.transitions[0].next).toBe('SHARKS_r1_play')
  })

  it('routes the countering digit onward and everything else to the loss', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const gather = widgets.find((w) => w.name === 'SHARKS_r1_gather')!
    // Round one announces Kick, which PUNCH counters, and PUNCH is digit 1.
    expect(gather.transitions).toContainEqual({
      event: 'keypress',
      condition: 'Digits equals 1',
      next: 'SHARKS_r2_play',
    })
    expect(gather.transitions).toContainEqual({ event: 'noMatch', next: 'DROWNED_play' })
    // Silence loses too — the playtest engine agrees, and they must not differ.
    expect(gather.transitions).toContainEqual({ event: 'timeout', next: 'DROWNED_play' })
  })

  it('sends the last round to the winning room', () => {
    const { widgets } = compileStory(sharkGraph(), 'https://audio/')
    const last = widgets.find((w) => w.name === 'SHARKS_r3_gather')!
    expect(last.transitions[0].next).toBe('SHORE_play')
  })

  it('warns about a round nothing counters instead of exporting it quietly', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [])
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Headbutt'],
      win: 'WIN',
      lose: 'LOSE',
    })
    const { warnings, widgets } = compileStory(g, 'https://audio/')
    expect(warnings.join(' ')).toContain('cannot be won')
    // Still emitted, and every answer loses — but only one transition out.
    const gather = widgets.find((w) => w.name === 'A_r1_gather')!
    expect(gather.transitions.every((t) => t.next === 'LOSE_play')).toBe(true)
  })

  it('warns when a fight room also has doors', () => {
    const g = makeGraph(['A', 'B', 'WIN', 'LOSE'], ['A>B'])
    addFight(g, 'A', { moves: ['P beats K'], rounds: ['K'], win: 'WIN', lose: 'LOSE' })
    expect(compileStory(g, 'https://audio/').warnings.join(' ')).toContain('not exported')
  })
})

describe('scripts', () => {
  it('puts fight rounds in the printable script', () => {
    const script = printableScript(sharkGraph())
    expect(script).toContain('[fight: The shark]')
    expect(script).toContain('→ press 1')
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
