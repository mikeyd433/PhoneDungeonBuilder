import { create } from 'zustand'
import type {
  Choice,
  DerivedGraph,
  Digit,
  MembershipRole,
  StoryGraph,
  StoryNode,
} from '@/types/domain'
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
