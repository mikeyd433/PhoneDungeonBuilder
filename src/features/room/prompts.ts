import type { DerivedGraph } from '@/types/domain'

/**
 * Turning a room's doors into the words that offer them.
 *
 * "Press 1 for the deck" is script — it gets recorded and played down a phone —
 * but it is also a restatement of data the room already holds. Written by hand
 * it drifts the moment a label changes, and an imported story has 143 rooms
 * whose doors were never announced at all.
 *
 * So this generates it, and generates it *again* on demand: re-running replaces
 * the block it wrote last time rather than appending a second copy, which is
 * what makes it safe to press after every label edit.
 */

/** How the caller is told to press a key that isn't a numeral. */
const SPOKEN: Record<string, string> = { '*': 'star', '#': 'pound' }

export type Joiner = 'for' | 'to'

export function promptLine(digit: string, text: string, joiner: Joiner): string {
  return `Press ${SPOKEN[digit] ?? digit} ${joiner} ${text}.`
}

/**
 * A prompt line, for the purpose of replacing one we wrote before.
 *
 * Deliberately loose about the tail: the whole point is that the author edits
 * these afterwards, and an edited line still has to be recognised as the thing
 * to replace or the next press appends a stale duplicate.
 */
export function isPromptLine(line: string): boolean {
  return /^\s*press\s+(?:[0-9*#]|star|pound|hash)\b/i.test(line)
}

/** Drop a run of prompt lines from the end, leaving the prose alone. */
export function stripTrailingPrompts(text: string): string {
  const lines = text.split('\n')
  while (lines.length > 0) {
    const last = lines[lines.length - 1]
    if (last.trim() === '' || isPromptLine(last)) lines.pop()
    else break
  }
  return lines.join('\n')
}

/**
 * What this room's doors should say, in keypad order.
 *
 * A door with no label is skipped, not filled in from the room behind it.
 * Borrowing the room's name there made the room's title into what the previous
 * room's door said — rename the room and the door two rooms back changed with
 * it — and it made two doors to the same place impossible to tell apart, since
 * both would announce that one name. A door is its own piece of writing.
 *
 * Skipping silently would be its own bug, so `unlabelledDoors` names them and
 * the editor says so beside the button.
 */
export function promptsFor(derived: DerivedGraph, nodeId: string, joiner: Joiner): string[] {
  const out: string[] = []
  for (const choice of derived.children.get(nodeId) ?? []) {
    const text = choice.label.trim()
    if (!text) continue
    out.push(promptLine(choice.digit, text, joiner))
  }
  return out
}

/** The digits of this room's doors that have nothing to announce. Wired or not:
 *  either way there are no words for that key, and only the author has them. */
export function unlabelledDoors(derived: DerivedGraph, nodeId: string): string[] {
  return (derived.children.get(nodeId) ?? []).filter((c) => !c.label.trim()).map((c) => c.digit)
}

/** The room's text with its prompts refreshed at the end. */
export function withPrompts(narration: string, prompts: string[]): string {
  const body = stripTrailingPrompts(narration).trimEnd()
  if (prompts.length === 0) return body
  return body === '' ? prompts.join('\n') : `${body}\n\n${prompts.join('\n')}`
}
