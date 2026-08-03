import type { StoryGraph } from '@/types/domain'
import { referencedVars } from './expression'

/**
 * Whether the satchel actually does anything.
 *
 * An item is two halves that live in different tables: an `effects` row hands
 * it over, and a `gates` expression asks for it later. Neither half is wrong on
 * its own, and nothing in the app ever complained — so a story can end up with
 * five items granted in a dozen places and not one door that checks for any of
 * them. The satchel fills up and the dungeon plays identically either way.
 *
 * The reverse is worse and quieter still: a gate that asks for something no
 * effect ever grants is a door no caller can open, which reads on the phone as
 * a refusal that never stops being one.
 */

export type ItemVerdict = 'sealed' | 'inert' | 'unused' | 'silent' | 'fine'

export interface ItemFinding {
  varId: string
  slug: string
  name: string
  verdict: ItemVerdict
  /** Rooms and doors that hand it over, and gates that ask for it. */
  grants: number
  revokes: number
  checks: number
  /** One line, in the terms the author thinks in. */
  message: string
}

/** Worst first: a door nobody can open beats an item that merely does nothing. */
const ORDER: Record<ItemVerdict, number> = { sealed: 0, inert: 1, unused: 2, silent: 3, fine: 4 }

export function auditItems(graph: StoryGraph): ItemFinding[] {
  // Gates hold slugs, effects hold ids. Both sides have to be counted in the
  // same currency or every item looks unused.
  const checked = new Map<string, number>()
  for (const gate of graph.gates.values()) {
    for (const slug of referencedVars(gate.expression)) {
      checked.set(slug.toUpperCase(), (checked.get(slug.toUpperCase()) ?? 0) + 1)
    }
  }

  const granted = new Map<string, number>()
  const revoked = new Map<string, number>()
  for (const effect of graph.effects.values()) {
    const bucket = effect.operation === 'grant' || effect.operation === 'add' ? granted : revoked
    bucket.set(effect.state_var_id, (bucket.get(effect.state_var_id) ?? 0) + 1)
  }

  const findings: ItemFinding[] = []
  for (const v of graph.stateVars.values()) {
    const grants = granted.get(v.id) ?? 0
    const revokes = revoked.get(v.id) ?? 0
    const checks = checked.get(v.slug.toUpperCase()) ?? 0
    const name = v.name?.trim() || v.slug

    let verdict: ItemVerdict = 'fine'
    let message = `Granted in ${grants} place${grants === 1 ? '' : 's'} and checked by ${checks} gate${checks === 1 ? '' : 's'}.`

    if (checks > 0 && grants === 0) {
      verdict = 'sealed'
      message = `${checks} gate${checks === 1 ? '' : 's'} ask${checks === 1 ? 's' : ''} for ${name}, and nothing in the story ever grants it. Those doors can never be opened.`
    } else if (grants === 0 && revokes === 0 && checks === 0) {
      verdict = 'unused'
      message = `${name} is in the list and nothing uses it — nothing grants it, nothing takes it, no door asks for it.`
    } else if (grants > 0 && checks === 0) {
      verdict = 'inert'
      message = `${name} is handed over in ${grants} place${grants === 1 ? '' : 's'} and no door ever asks for it, so carrying it changes nothing.`
    } else if (revokes > 0 && grants === 0) {
      verdict = 'sealed'
      message = `${name} is taken away in ${revokes} place${revokes === 1 ? '' : 's'} but never given.`
    } else if (graph.story.inventory_key && v.kind === 'item' && !v.audio_path) {
      // Only when something reads the satchel out loud: an unrecorded name is
      // a gap in a list the caller actually hears.
      verdict = 'silent'
      message = `${name} has no recording of its name, so the inventory readback says nothing where it should say this.`
    }

    findings.push({ varId: v.id, slug: v.slug, name, verdict, grants, revokes, checks, message })
  }

  return findings.sort(
    (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.slug.localeCompare(b.slug),
  )
}

/** Just the ones worth acting on. */
export const itemProblems = (graph: StoryGraph) =>
  auditItems(graph).filter((f) => f.verdict !== 'fine')
