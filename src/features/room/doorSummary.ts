import type { StoryGraph } from '@/types/domain'
import { describeExpression, type NamedVar } from '@/features/state/describe'

/**
 * What a door already is, in a sentence.
 *
 * The door sheet is meant to be the one place a door is answered, and it was
 * the only surface in the app that said nothing about the door it was for:
 * "Where it leads — Ashore · tap to fork it on an item" on a door that already
 * forked (the second room unnamed), and "When it is offered — Always, in some
 * states, or on a condition" on every door in the story, whatever its rules.
 * The panel row that opens the sheet knew more than the sheet: it draws `⑂`.
 *
 * §0's first rule is that every visual element encodes real data, so both rows
 * read the door. Pure, because the same two sentences belong on the ledger and
 * in the export's build sheet, and neither of those has a React tree.
 */

function named(graph: StoryGraph): NamedVar[] {
  return [...graph.stateVars.values()].map((v) => ({ slug: v.slug, name: v.name }))
}

function roomName(graph: StoryGraph, id: string | null): string | null {
  if (!id) return null
  const node = graph.nodes.get(id)
  return node?.title?.trim() || node?.slug || null
}

export interface LeadsSummary {
  /** The destination, or both of them when the key forks. */
  text: string
  /** What tapping the row does — different once there are two routes to change. */
  hint: string
  forks: boolean
}

/** Where pressing this key lands, counting a fork as the two rooms it is. */
export function leadsSummary(graph: StoryGraph, choiceId: string): LeadsSummary {
  const choice = graph.choices.get(choiceId)
  if (!choice) return { text: '— nowhere yet —', hint: '', forks: false }

  const gate = [...graph.gates.values()].find((g) => g.choice_id === choiceId)
  const main = roomName(graph, choice.to_node_id) ?? '— nowhere yet —'

  if (gate?.fail_behavior !== 'divert') {
    return {
      text: main,
      hint: 'Tap to change it, or to fork it on an item.',
      forks: false,
    }
  }

  const other = roomName(graph, gate.fail_node_id) ?? '— nowhere yet —'
  return {
    text: `${main}, or ${other}`,
    // The condition is the whole point of a fork, so it is said rather than
    // implied by the two names — "Ashore, or Down" is not an answer to which.
    hint: `Forks: ${main} when ${describeExpression(named(graph), gate.expression)}. Tap to change either route.`,
    forks: true,
  }
}

/**
 * What passing through this door does to what the caller is carrying.
 *
 * The wall already draws `+A coil of rope` beside the arch; the door sheet —
 * the surface calling itself everything about one door — had no row for it at
 * all, so the commonest job in an item story was the one job the sheet could
 * not start. Returns null when the door changes nothing, because a row saying
 * "nothing" on every door in the story is the noise §0 exists to prevent.
 */
export function effectsSummary(graph: StoryGraph, choiceId: string): string | null {
  const gives: string[] = []
  const takes: string[] = []
  for (const effect of graph.effects.values()) {
    if (effect.choice_id !== choiceId) continue
    const v = graph.stateVars.get(effect.state_var_id)
    const name = v?.name?.trim() || v?.slug || '?'
    ;(effect.operation === 'grant' || effect.operation === 'add' ? gives : takes).push(name)
  }
  const parts: string[] = []
  if (gives.length > 0) parts.push(`+${gives.join(', +')}`)
  if (takes.length > 0) parts.push(`−${takes.join(', −')}`)
  return parts.length > 0 ? parts.join(' ') : null
}

export interface OfferedSummary {
  text: string
  /** Nobody is ever offered it — an `or` with nothing in it. Worth the alarm
   *  colour, because from the editor it looks like a working condition. */
  never: boolean
}

/**
 * When the caller is offered this key at all.
 *
 * One mechanism now: a `hide` gate. The reading-slot half of this went with
 * `hidden_doors` — a door a room only sometimes offers is a condition, and the
 * room that announces it is a fork away.
 */
export function offeredSummary(graph: StoryGraph, choiceId: string): OfferedSummary {
  const gate = [...graph.gates.values()].find((g) => g.choice_id === choiceId)
  if (gate?.fail_behavior !== 'hide') return { text: 'Always', never: false }
  const said = describeExpression(named(graph), gate.expression)
  return { text: `Only when ${said}`, never: said === 'never' }
}
