import { create } from 'zustand'
import type {
  Character,
  Choice,
  DerivedGraph,
  Digit,
  Fight,
  FightMove,
  FightRound,
  MembershipRole,
  StoryGraph,
  StoryNode,
} from '@/types/domain'
import { composeNarration } from '@/features/cast/dialogue'
import { deriveGraph } from './derived'
import * as api from '@/lib/api'
import { uniqueSlug } from '@/lib/slug'
import { enqueue, isOffline } from '@/lib/offlineQueue'

/** F2.10 — undo stack, last 20 actions. */
const UNDO_LIMIT = 20

/**
 * Undo is a journal of inverse operations, not a stack of snapshots.
 *
 * A snapshot only restores local state, which is worse than useless here: every
 * mutation is already persisted, so restoring the old Maps and then reading from
 * the server just brings the change straight back. To actually undo, the inverse
 * has to be replayed against Postgres.
 */
interface UndoEntry {
  label: string
  invert: () => Promise<void>
}

interface DelveState {
  graph: StoryGraph | null
  derived: DerivedGraph | null
  role: MembershipRole | null
  /** Where the author is standing. */
  currentNodeId: string | null
  /** Rooms walked through, for the retreat path and the breadcrumb. */
  trail: string[]
  undoStack: UndoEntry[]
  loading: boolean
  error: string | null

  loadStory: (storyId: string) => Promise<void>
  walkTo: (nodeId: string) => void
  retreat: () => void
  clearError: () => void

  createChildNode: (fromChoiceId: string, title?: string) => Promise<string | null>
  addChoice: (fromNodeId: string, digit: Digit, label?: string) => Promise<void>
  updateNode: (id: string, patch: Partial<StoryNode>) => Promise<void>
  updateChoice: (id: string, patch: Partial<Choice>) => Promise<void>
  deleteChoice: (id: string) => Promise<void>

  addCharacter: (patch: { slug: string; name: string } & Partial<Character>) => Promise<void>
  editCharacter: (id: string, patch: Partial<Character>) => Promise<void>
  removeCharacter: (id: string) => Promise<void>

  /** Replace a room's lines AND rewrite its narration from them, in that order,
   *  so the recorded text and the script can never disagree. */
  saveDialogue: (
    nodeId: string,
    lines: Array<{ character_id: string | null; text: string }>,
  ) => Promise<void>

  addFight: (nodeId: string) => Promise<void>
  editFight: (id: string, patch: Partial<Fight>) => Promise<void>
  removeFight: (id: string) => Promise<void>
  addFightMove: (fightId: string, slug: string) => Promise<void>
  editFightMove: (id: string, patch: Partial<FightMove>) => Promise<void>
  removeFightMove: (id: string) => Promise<void>
  addFightRound: (fightId: string) => Promise<void>
  editFightRound: (id: string, patch: Partial<FightRound>) => Promise<void>
  removeFightRound: (id: string) => Promise<void>

  undo: () => Promise<void>
  canUndo: () => boolean
  /** Re-read the story after a write this store doesn't model (items, gates). */
  refresh: () => Promise<void>
}

export const useDelve = create<DelveState>((set, get) => {
  /** Apply a mutation to the in-memory graph and recompute derived structure. */
  const patchGraph = (mutate: (g: StoryGraph) => StoryGraph) => {
    set((s) => {
      if (!s.graph) return s
      const graph = mutate(s.graph)
      return { ...s, graph, derived: deriveGraph(graph) }
    })
  }

  const pushUndo = (entry: UndoEntry) => {
    set((s) => ({ ...s, undoStack: [...s.undoStack, entry].slice(-UNDO_LIMIT) }))
  }

  const fail = (e: unknown) => {
    set({ error: e instanceof Error ? e.message : String(e) })
  }

  /**
   * Cast and fight edits go through one path: run the write, then drop the
   * returned row into its map.
   *
   * These are low-frequency, low-field-count edits — a move's slug, a round's
   * narration — so unlike node and choice editing they are NOT optimistic. The
   * round trip is invisible against how long it takes to type the next field,
   * and skipping the optimism means there is no rollback path to get wrong.
   */
  const write = async <K extends 'characters' | 'dialogue' | 'fights' | 'fightMoves' | 'fightRounds'>(
    key: K,
    run: (graph: StoryGraph) => Promise<Array<{ id: string }> | { id: string } | null>,
    undoEntry?: (graph: StoryGraph) => UndoEntry,
  ) => {
    const { graph } = get()
    if (!graph) return
    try {
      const result = await run(graph)
      const rows = result === null ? [] : Array.isArray(result) ? result : [result]
      patchGraph((g) => {
        const map = new Map(g[key] as unknown as Map<string, { id: string }>)
        for (const row of rows) map.set(row.id, row)
        return { ...g, [key]: map } as StoryGraph
      })
      if (undoEntry) pushUndo(undoEntry(graph))
    } catch (e) {
      fail(e)
    }
  }

  /** Deletes have to drop the row locally too, which `write` can't express. */
  const wipe = async (
    key: 'characters' | 'dialogue' | 'fights' | 'fightMoves' | 'fightRounds',
    id: string,
    run: () => Promise<void>,
    label: string,
    invert: () => Promise<void>,
  ) => {
    const { graph } = get()
    if (!graph) return
    try {
      await run()
      patchGraph((g) => {
        const map = new Map(g[key] as unknown as Map<string, unknown>)
        map.delete(id)
        return { ...g, [key]: map } as StoryGraph
      })
      pushUndo({ label, invert })
    } catch (e) {
      fail(e)
    }
  }

  return {
    graph: null,
    derived: null,
    role: null,
    currentNodeId: null,
    trail: [],
    undoStack: [],
    loading: false,
    error: null,

    clearError: () => set({ error: null }),
    canUndo: () => get().undoStack.length > 0,

    async loadStory(storyId) {
      set({ loading: true, error: null })
      try {
        const [graph, role] = await Promise.all([api.loadStoryGraph(storyId), api.myRole(storyId)])
        const root = graph.story.root_node_id
        set({
          graph,
          derived: deriveGraph(graph),
          role,
          currentNodeId: root,
          trail: root ? [root] : [],
          undoStack: [],
          loading: false,
        })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), loading: false })
      }
    },

    walkTo(nodeId) {
      set((s) => ({ ...s, currentNodeId: nodeId, trail: [...s.trail, nodeId] }))
    },

    retreat() {
      const { trail, derived, currentNodeId } = get()
      if (trail.length > 1) {
        const next = trail.slice(0, -1)
        set({ currentNodeId: next[next.length - 1], trail: next })
        return
      }
      // No trail to walk back (deep-linked, or teleported in from the automap):
      // fall back to the graph's own inbound edges. F1.12's multi-parent chooser
      // is the UI for picking when there is more than one; this takes the first.
      if (!derived || !currentNodeId) return
      const inbound = derived.parents.get(currentNodeId) ?? []
      if (inbound.length > 0) {
        set({ currentNodeId: inbound[0].from_node_id, trail: [inbound[0].from_node_id] })
      }
    },

    /** F1.3 — tap a bricked arch to chisel through it: creates the node, wires
     *  the choice to it, and walks you in. */
    async createChildNode(fromChoiceId, title) {
      const { graph } = get()
      if (!graph) return null
      const choice = graph.choices.get(fromChoiceId)
      if (!choice) return null

      const label = title || choice.label || 'New room'
      const slug = uniqueSlug(
        label,
        [...graph.nodes.values()].map((n) => n.slug),
      )

      try {
        const node = await api.createNode(graph.story.id, { slug, title: label })
        const wired = await api.updateChoice(fromChoiceId, { to_node_id: node.id })

        patchGraph((g) => ({
          ...g,
          nodes: new Map(g.nodes).set(node.id, node),
          choices: new Map(g.choices).set(wired.id, wired),
        }))
        set((s) => ({ ...s, currentNodeId: node.id, trail: [...s.trail, node.id] }))

        pushUndo({
          label: `chisel ${slug}`,
          invert: async () => {
            // Unwire first so the choice survives the node delete as a bricked
            // archway, which is what it was before.
            await api.updateChoice(fromChoiceId, { to_node_id: null })
            await api.deleteNode(node.id)
          },
        })
        return node.id
      } catch (e) {
        fail(e)
        return null
      }
    },

    async addChoice(fromNodeId, digit, label = '') {
      const { graph } = get()
      if (!graph) return
      try {
        const choice = await api.createChoice(graph.story.id, {
          from_node_id: fromNodeId,
          digit,
          label,
          sort_order: Number(digit) || 0,
        })
        patchGraph((g) => ({ ...g, choices: new Map(g.choices).set(choice.id, choice) }))
        pushUndo({
          label: `add exit ${digit}`,
          invert: () => api.deleteChoice(choice.id),
        })
      } catch (e) {
        fail(e)
      }
    },

    async updateNode(id, rawPatch) {
      const { graph } = get()
      if (!graph) return
      const before = graph.nodes.get(id)
      if (!before) return

      // F3.4 — writing narration into a blank room advances it stub -> scripted
      // on its own. Only ever an upgrade: never demote, and never touch a room
      // that already has audio or an explicit status set by this same call.
      let patch = rawPatch
      if (
        rawPatch.narration !== undefined &&
        rawPatch.status === undefined &&
        before.status === 'stub' &&
        !before.audio_path &&
        String(rawPatch.narration).trim() !== ''
      ) {
        patch = { ...rawPatch, status: 'scripted' }
      }

      // Optimistic: the editor autosaves on blur (F2.2), and a round trip per
      // field would make the sheet feel laggy on a tablet.
      patchGraph((g) => ({ ...g, nodes: new Map(g.nodes).set(id, { ...before, ...patch }) }))

      try {
        const saved = await api.updateNode(id, patch)
        patchGraph((g) => ({ ...g, nodes: new Map(g.nodes).set(id, saved) }))

        // Only the fields this call actually changed are restored, so undo does
        // not clobber a concurrent edit to an unrelated field.
        const inverse: Partial<StoryNode> = {}
        for (const key of Object.keys(patch) as Array<keyof StoryNode>) {
          inverse[key] = before[key] as never
        }
        pushUndo({
          label: `edit ${before.slug}`,
          invert: async () => {
            await api.updateNode(id, inverse)
          },
        })
      } catch (e) {
        // F7.4 — a write that failed because the signal dropped hasn't been
        // rejected, it just hasn't landed yet. Keep the optimistic state and
        // queue it; the sync hook replays it on reconnect.
        if (isOffline(e)) {
          await enqueue({
            table: 'nodes',
            op: 'update',
            rowId: id,
            payload: patch as Record<string, unknown>,
            storyId: graph.story.id,
          })
          return
        }
        // A real rejection: roll back, so the UI never claims a save the
        // database refused — RLS blocking a `voice` edit lands here.
        patchGraph((g) => ({ ...g, nodes: new Map(g.nodes).set(id, before) }))
        fail(e)
      }
    },

    async updateChoice(id, patch) {
      const { graph } = get()
      if (!graph) return
      const before = graph.choices.get(id)
      if (!before) return

      patchGraph((g) => ({ ...g, choices: new Map(g.choices).set(id, { ...before, ...patch }) }))

      try {
        const saved = await api.updateChoice(id, patch)
        patchGraph((g) => ({ ...g, choices: new Map(g.choices).set(id, saved) }))

        const inverse: Partial<Choice> = {}
        for (const key of Object.keys(patch) as Array<keyof Choice>) {
          inverse[key] = before[key] as never
        }
        pushUndo({
          label: 'edit exit',
          invert: async () => {
            await api.updateChoice(id, inverse)
          },
        })
      } catch (e) {
        if (isOffline(e)) {
          await enqueue({
            table: 'choices',
            op: 'update',
            rowId: id,
            payload: patch as Record<string, unknown>,
            storyId: graph.story.id,
          })
          return
        }
        patchGraph((g) => ({ ...g, choices: new Map(g.choices).set(id, before) }))
        fail(e)
      }
    },

    async deleteChoice(id) {
      const { graph } = get()
      if (!graph) return
      const before = graph.choices.get(id)
      if (!before) return
      try {
        await api.deleteChoice(id)
        patchGraph((g) => {
          const choices = new Map(g.choices)
          choices.delete(id)
          return { ...g, choices }
        })
        pushUndo({
          label: 'remove exit',
          // Recreating yields a new id. Nothing references a choice id except
          // gates and effects, which cascade-deleted with it, so this restores
          // the archway itself but not any gate that hung off it.
          invert: async () => {
            await api.createChoice(before.story_id, {
              from_node_id: before.from_node_id,
              digit: before.digit,
              label: before.label,
              to_node_id: before.to_node_id,
              sort_order: before.sort_order,
            })
          },
        })
      } catch (e) {
        fail(e)
      }
    },

    // ------------------------------------------------------------ cast

    async addCharacter(patch) {
      await write<'characters'>('characters', (g) => api.createCharacter(g.story.id, patch))
    },

    async editCharacter(id, patch) {
      await write<'characters'>('characters', () => api.updateCharacter(id, patch))
    },

    async removeCharacter(id) {
      // Deleting a character nulls the character_id on every line they spoke
      // (the FK is ON DELETE SET NULL), so the lines that survive have to be
      // re-read rather than guessed at.
      const { graph } = get()
      if (!graph) return
      try {
        await api.deleteCharacter(id)
        await get().refresh()
      } catch (e) {
        fail(e)
      }
    },

    async saveDialogue(nodeId, lines) {
      const { graph } = get()
      if (!graph) return
      const node = graph.nodes.get(nodeId)
      if (!node) return

      const nameOf = (id: string | null) =>
        id ? (graph.characters.get(id)?.name ?? null) : null
      const narration = composeNarration(
        lines.map((l) => ({ speaker: nameOf(l.character_id), text: l.text })),
      )

      try {
        const saved = await api.replaceDialogue(graph.story.id, nodeId, lines)
        // The narration is written second on purpose: if the line write fails,
        // the recorded text is still the text the lines were derived from.
        //
        // Clearing every line means "stop splitting this room", NOT "this room
        // says nothing" — rewriting the narration to an empty string there would
        // silently delete the script.
        if (lines.length > 0) await get().updateNode(nodeId, { narration })
        patchGraph((g) => {
          const dialogue = new Map(g.dialogue)
          for (const [id, line] of dialogue) if (line.node_id === nodeId) dialogue.delete(id)
          for (const line of saved) dialogue.set(line.id, line)
          return { ...g, dialogue }
        })
      } catch (e) {
        fail(e)
      }
    },

    // ------------------------------------------------------------ fights

    async addFight(nodeId) {
      await write<'fights'>('fights', (g) => api.createFight(g.story.id, { node_id: nodeId }))
    },

    async editFight(id, patch) {
      await write<'fights'>('fights', () => api.updateFight(id, patch))
    },

    async removeFight(id) {
      // Moves and rounds cascade with it; refresh rather than track the cascade.
      try {
        await api.deleteFight(id)
        await get().refresh()
      } catch (e) {
        fail(e)
      }
    },

    async addFightMove(fightId, slug) {
      const existing = [...(get().graph?.fightMoves.values() ?? [])].filter(
        (m) => m.fight_id === fightId,
      )
      await write<'fightMoves'>('fightMoves', (g) =>
        api.createFightMove(g.story.id, {
          fight_id: fightId,
          slug,
          label: slug.toLowerCase(),
          sort_order: existing.length,
        }),
      )
    },

    async editFightMove(id, patch) {
      await write<'fightMoves'>('fightMoves', () => api.updateFightMove(id, patch))
    },

    async removeFightMove(id) {
      const before = get().graph?.fightMoves.get(id)
      if (!before) return
      await wipe('fightMoves', id, () => api.deleteFightMove(id), `remove ${before.slug}`, async () => {
        await api.createFightMove(before.story_id, {
          fight_id: before.fight_id,
          slug: before.slug,
          label: before.label,
          beats: before.beats,
          sort_order: before.sort_order,
        })
      })
    },

    async addFightRound(fightId) {
      const existing = [...(get().graph?.fightRounds.values() ?? [])].filter(
        (r) => r.fight_id === fightId,
      )
      await write<'fightRounds'>('fightRounds', (g) =>
        api.createFightRound(g.story.id, { fight_id: fightId, sort_order: existing.length }),
      )
    },

    async editFightRound(id, patch) {
      await write<'fightRounds'>('fightRounds', () => api.updateFightRound(id, patch))
    },

    async removeFightRound(id) {
      const before = get().graph?.fightRounds.get(id)
      if (!before) return
      await wipe(
        'fightRounds',
        id,
        () => api.deleteFightRound(id),
        `remove round ${before.sort_order + 1}`,
        async () => {
          await api.createFightRound(before.story_id, {
            fight_id: before.fight_id,
            sort_order: before.sort_order,
            opponent_move: before.opponent_move,
            narration: before.narration,
          })
        },
      )
    },

    async refresh() {
      const { graph, currentNodeId } = get()
      if (!graph) return
      await get().loadStory(graph.story.id)
      set((s) => {
        if (currentNodeId && s.graph?.nodes.has(currentNodeId)) {
          return { ...s, currentNodeId, trail: [currentNodeId] }
        }
        return s
      })
    },

    /** F2.10. Replays the inverse against the database, then reloads so local
     *  state matches what actually persisted. */
    async undo() {
      const { undoStack, graph } = get()
      const last = undoStack[undoStack.length - 1]
      if (!last || !graph) return

      set({ undoStack: undoStack.slice(0, -1) })
      try {
        await last.invert()
      } catch (e) {
        fail(e)
      }

      const standing = get().currentNodeId
      await get().loadStory(graph.story.id)

      // Stay where the author was standing if that room still exists.
      set((s) => {
        if (standing && s.graph?.nodes.has(standing)) {
          return { ...s, currentNodeId: standing, trail: [standing] }
        }
        return s
      })
    },
  }
})
