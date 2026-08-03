import { describe, expect, it } from 'vitest'
import { collapseCandidates, looksLikeScript, suggestShortTitle, titlesToTidy } from './tidy'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addLines, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

const titled = (g: StoryGraph, slug: string, title: string, narration = '') => {
  const id = idOf(g, slug)
  g.nodes.set(id, { ...g.nodes.get(id)!, title, narration })
  return id
}

describe('suggesting a short name', () => {
  it.each([
    ['You have reached the JCFC hotline. A door swings open.', 'You have reached the JCFC'],
    ['(If you have helmet) Press 1 to offer him Tony', 'Press 1 to offer him'],
    ['Press 1 to turn left, press 2 to turn right', 'Press 1 to turn left'],
  ])('takes the first clause of %j', (title, want) => {
    expect(suggestShortTitle(title)).toBe(want)
  })

  /** A speaker is not the room's name. Lowercase counts — the import is full
   *  of "both:". */
  it.each([
    ['CARTER: Hey there, you forgot it', 'Hey there'],
    ['both: We are lost', 'We are lost'],
  ])('drops the speaker from %j', (title, want) => {
    expect(suggestShortTitle(title)).toBe(want)
  })

  /** "Hey Mr. Hawk" split at the abbreviation gave "Hey Mr", which is worse
   *  than offering nothing at all. */
  it('does not mistake an abbreviation for the end of a sentence', () => {
    expect(suggestShortTitle('CARTER: Hey Mr. Hawk, you forgot your helmet!')).toBe('Hey Mr. Hawk')
  })

  it('lifts out a parenthetical rather than leaving a dangling bracket', () => {
    const out = suggestShortTitle("As Tony (we're on a first name basis) skates away")
    expect(out).not.toContain('(')
    expect(out).toBe('As Tony skates away')
  })

  it('drops the trailing ellipsis — a name has no more to come', () => {
    expect(suggestShortTitle('We are not doing that…')).toBe('We are not doing that')
  })

  it('has nothing to offer for a title that is only punctuation', () => {
    expect(suggestShortTitle('...')).toBe('')
  })

  it('leaves a name that is already a name alone', () => {
    expect(looksLikeScript('The flooded hold')).toBe(false)
    expect(looksLikeScript('helmet')).toBe(false)
  })
})

describe('which titles get offered', () => {
  it('flags a sentence and skips a name', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    titled(g, 'A', 'You have reached the JCFC hotline. A door swings open onto black water.')
    titled(g, 'B', 'The flooded hold')
    expect(titlesToTidy(g).map((t) => t.slug)).toEqual(['A'])
  })

  it('offers nothing when the suggestion would be the title back again', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    // Long enough to be flagged, but there is no shorter first clause in it.
    titled(g, 'A', 'Averyveryverylongsinglewordroomnamewithnobreaks')
    expect(titlesToTidy(g)).toEqual([])
  })

  /**
   * The old title is script sitting in the wrong column — it is what the caller
   * hears. Throwing it away to tidy a name would delete the writing.
   */
  it('rescues the old title into the narration', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    titled(g, 'A', 'You have reached the hotline. A door swings open.', 'Water to the ankle.')
    const [fix] = titlesToTidy(g)
    expect(fix.narration).toBe(
      'You have reached the hotline. A door swings open.\n\nWater to the ankle.',
    )
  })

  /** The importer put the same text in both columns often enough that appending
   *  blindly would give half the story a stutter. */
  it('does not append a title the narration already says', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const line = 'You have reached the hotline. A door swings open.'
    titled(g, 'A', line, `${line} Water to the ankle.`)
    expect(titlesToTidy(g)[0].narration).toBeNull()
  })
})

describe('rooms that were actions', () => {
  const chain = () => {
    const g = makeGraph(['START', 'ENTER_DOOR', 'CAVE'], ['START>ENTER_DOOR', 'ENTER_DOOR>CAVE'])
    titled(g, 'ENTER_DOOR', 'Enter the door')
    titled(g, 'CAVE', 'The dripping cave')
    return g
  }
  const found = (g: StoryGraph) => collapseCandidates(g, deriveGraph(g)).map((c) => c.slug)

  it('spots a verb between two places', () => {
    expect(found(chain())).toEqual(['ENTER_DOOR'])
  })

  it('leaves a real room alone, however collapsible it happens to be', () => {
    const g = chain()
    titled(g, 'ENTER_DOOR', 'The vestibule')
    expect(found(g)).toEqual([])
  })

  it('leaves an action room that has something written in it', () => {
    const g = chain()
    titled(
      g,
      'ENTER_DOOR',
      'Enter the door',
      'The hinges have not moved in years, and something behind them shifts as you push.',
    )
    expect(found(g)).toEqual([])
  })

  /** planCollapse has the final say, so nothing here can propose a collapse
   *  that would lose work. */
  it('never offers a room carrying dialogue', () => {
    const g = chain()
    addCharacter(g, 'carter', { name: 'Carter' })
    addLines(g, 'ENTER_DOOR', ['carter|Careful.'])
    expect(found(g)).toEqual([])
  })

  it('never offers the entrance', () => {
    const g = chain()
    titled(g, 'START', 'Go inside')
    expect(found(g)).not.toContain('START')
  })

  it('says where each one would join to', () => {
    const [candidate] = collapseCandidates(chain(), deriveGraph(chain()))
    expect(candidate.plan.toTitle).toBe('The dripping cave')
    expect(candidate.because).toContain('The dripping cave')
  })
})
