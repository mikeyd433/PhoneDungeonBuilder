import { describe, expect, it } from 'vitest'
import {
  isPromptLine,
  promptsFor,
  stripTrailingPrompts,
  unlabelledDoors,
  withPrompts,
} from './prompts'
import { deriveGraph } from '@/features/graph/derived'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Digit, StoryGraph } from '@/types/domain'

const label = (g: StoryGraph, from: string, to: string, text: string) => {
  const id = choiceOf(g, from, to)
  g.choices.set(id, { ...g.choices.get(id)!, label: text })
}
const digit = (g: StoryGraph, from: string, to: string, d: string) => {
  const id = choiceOf(g, from, to)
  g.choices.set(id, { ...g.choices.get(id)!, digit: d as Digit })
}
const promptsAt = (g: StoryGraph, slug: string, joiner: 'for' | 'to' = 'for') =>
  promptsFor(deriveGraph(g), idOf(g, slug), joiner)

describe('promptsFor', () => {
  it('offers each door in keypad order', () => {
    const g = makeGraph(['HUB', 'A', 'B'], ['HUB>A', 'HUB>B'])
    label(g, 'HUB', 'A', 'the deck')
    label(g, 'HUB', 'B', 'the hold')
    expect(promptsAt(g, 'HUB')).toEqual(['Press 1 for the deck.', 'Press 2 for the hold.'])
  })

  it('honours the digits, not the order the doors were made', () => {
    const g = makeGraph(['HUB', 'A', 'B'], ['HUB>A', 'HUB>B'])
    label(g, 'HUB', 'A', 'the deck')
    label(g, 'HUB', 'B', 'the hold')
    digit(g, 'HUB', 'A', '9')
    expect(promptsAt(g, 'HUB')).toEqual(['Press 2 for the hold.', 'Press 9 for the deck.'])
  })

  it('says star and pound out loud, because the script is read aloud', () => {
    const g = makeGraph(['HUB', 'A', 'B'], ['HUB>A', 'HUB>B'])
    label(g, 'HUB', 'A', 'the operator')
    label(g, 'HUB', 'B', 'the menu')
    digit(g, 'HUB', 'A', '*')
    digit(g, 'HUB', 'B', '#')
    expect(promptsAt(g, 'HUB')).toEqual([
      'Press star for the operator.',
      'Press pound for the menu.',
    ])
  })

  it('uses the "to" phrasing when asked', () => {
    const g = makeGraph(['HUB', 'A'], ['HUB>A'])
    label(g, 'HUB', 'A', 'go up on deck')
    expect(promptsAt(g, 'HUB', 'to')).toEqual(['Press 1 to go up on deck.'])
  })

  /**
   * The room behind a door is not what the door says.
   *
   * Borrowing the name made a room's title into the previous room's script:
   * rename the room and the door announcing it changed too, which is the one
   * coupling this whole feature exists to avoid.
   */
  it('never speaks the room’s name for an unlabelled door', () => {
    const g = makeGraph(['HUB', 'A'], ['HUB>A'])
    label(g, 'HUB', 'A', '   ')
    g.nodes.set(idOf(g, 'A'), { ...g.nodes.get(idOf(g, 'A'))!, title: 'The listing deck' })
    expect(promptsAt(g, 'HUB')).toEqual([])
    // Skipped, but never silently: the editor asks for words beside the button.
    expect(unlabelledDoors(deriveGraph(g), idOf(g, 'HUB'))).toEqual(['1'])
  })

  /**
   * Two doors to one room is the common shape — "force the locker" and "pick
   * the lock" both land in the locker — and each has to be able to say its own
   * thing. With the room-name fallback they announced the same words.
   */
  it('lets two doors to the same room say different things', () => {
    const g = makeGraph(['HUB', 'A'], ['HUB>A', 'HUB>A'])
    const [one, two] = [...g.choices.values()].filter((c) => c.to_node_id === idOf(g, 'A'))
    g.choices.set(one.id, { ...one, digit: '1', label: 'force the locker' })
    g.choices.set(two.id, { ...two, digit: '2', label: 'pick the lock' })
    g.nodes.set(idOf(g, 'A'), { ...g.nodes.get(idOf(g, 'A'))!, title: 'The locker' })

    expect(promptsAt(g, 'HUB')).toEqual([
      'Press 1 for force the locker.',
      'Press 2 for pick the lock.',
    ])
  })

  it('skips a door with neither a label nor anywhere to go', () => {
    const g = makeGraph(['HUB', 'A'], ['HUB>A', 'HUB>'])
    label(g, 'HUB', 'A', 'the deck')
    const bricked = [...g.choices.values()].find((c) => c.to_node_id === null)!
    g.choices.set(bricked.id, { ...bricked, label: '' })
    expect(promptsAt(g, 'HUB')).toEqual(['Press 1 for the deck.'])
  })

  it('has nothing to say for a room with no doors', () => {
    const g = makeGraph(['HUB'], [])
    expect(promptsAt(g, 'HUB')).toEqual([])
  })
})

describe('withPrompts', () => {
  const prompts = ['Press 1 for the deck.', 'Press 2 for the hold.']

  it('adds them after the prose', () => {
    expect(withPrompts('Water to the ankle.', prompts)).toBe(
      'Water to the ankle.\n\nPress 1 for the deck.\nPress 2 for the hold.',
    )
  })

  it('replaces its own last block rather than stacking a second copy', () => {
    const once = withPrompts('Water to the ankle.', prompts)
    const twice = withPrompts(once, prompts)
    expect(twice).toBe(once)
  })

  it('replaces prompts the author has since edited', () => {
    const edited = 'Water to the ankle.\n\nPress 1 for the OLD deck.\nPress 2 for the hold.'
    expect(withPrompts(edited, prompts)).toBe(
      'Water to the ankle.\n\nPress 1 for the deck.\nPress 2 for the hold.',
    )
  })

  it('leaves prose that merely mentions a key alone', () => {
    const prose = 'The keypad is worn. Someone has pressed 1 a thousand times.'
    expect(withPrompts(prose, prompts)).toBe(`${prose}\n\n${prompts.join('\n')}`)
  })

  it('handles an empty room', () => {
    expect(withPrompts('', prompts)).toBe(prompts.join('\n'))
  })

  it('strips the block when there is nothing left to offer', () => {
    const once = withPrompts('Water to the ankle.', prompts)
    expect(withPrompts(once, [])).toBe('Water to the ankle.')
  })
})

describe('isPromptLine', () => {
  it.each([
    'Press 1 for the deck.',
    'press 2 to go below',
    '  Press star for the operator.',
    'Press pound for the menu.',
  ])('recognises %j', (line) => expect(isPromptLine(line)).toBe(true))

  it.each([
    'Water to the ankle.',
    'He pressed 1 and waited.',
    'Depress the lever.',
    '',
  ])('leaves %j alone', (line) => expect(isPromptLine(line)).toBe(false))
})

describe('stripTrailingPrompts', () => {
  it('only takes them off the end', () => {
    const text = 'Press 1 for nothing.\n\nReal prose here.\n\nPress 2 for the hold.'
    expect(stripTrailingPrompts(text)).toBe('Press 1 for nothing.\n\nReal prose here.')
  })
})
