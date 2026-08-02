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
  Story,
  StoryGraph,
  StoryNode,
} from '@/types/domain'
import { composeNarration } from '@/features/cast/dialogue'
import { deriveGraph } from './derived'
import * as api from '@/lib/api'
import { uniqueSlug } from '@/lib/slug'
import { enqueue, isOffline } from '@/lib/offlineQueue'
import { buildDemoStory, DEMO_STORY_ID } from '@/features/demo/demoStory'
import { planCollapse } from '@/features/room/collapse'

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
  /** The in-memory walkthrough story. Nothing here touches the database. */
  demo: boolean

  loadStory: (storyId: string) => Promise<void>
  walkTo: (nodeId: string) => void
  retreat: () => void
  clearError: () => void

  createChildNode: (fromChoiceId: string, title?: string) => Promise<string | null>
  /** Splice a room out, joining what led to it to whatever it led to.
   *  Returns false and sets `error` when the room can't be collapsed. */
  collapseRoom: (nodeId: string) => Promise<boolean>
  /** Story-level settings: the inventory readback's key and its two takes. */
  updateStory: (patch: Partial<Story>) => Promise<void>
  setItemAudio: (id: string, path: string | null, durationMs: number | null) => Promise<void>
  /** The inverse: put a new room on an existing door, so A -> B becomes
   *  A -> new -> B. Walks into the new room. */
  insertRoomOnChoice: (choiceId: string, title?: string) => Promise<string | null>
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
    lines: Array<{
      character_id: string | null
      text: string
      audio_path?: string | null
      audio_duration_ms?: number | null
    }>,
  ) => Promise<void>
  /** Attach a take to one line. Separate from saveDialogue because the `voice`
   *  role may do this and may not touch anything else on the row. */
  setLineAudio: (id: string, path: string | null, durationMs: number | null) => Promise<void>

  addFight: (nodeId: string) => Promise<void>
  editFight: (id: string, patch: Partial<Fight>) => Promise<void>
  removeFight: (id: string) => Promise<void>
  addFightMove: (fightId: string, slug: string) => Promise<void>
  editFightMove: (id: string, patch: Partial<FightMove>) => Promise<void>
  removeFightMove: (id: string) => Promise<void>
  addFightRound: (fightId: string) => Promise<void>
  editFightRound: (id: string, patch: Partial<FightRound>) => Promise<void>
  removeFightRound: (id: string) => Promise<void>
  /**
   * Name where one move goes in one round.
   *
   * `to` distinguishes three states the UI has to be able to express:
   *   a node id -> go there
   *   null      -> written, but nowhere yet (a bricked branch)
   *   undefined -> unname it, and fall back to the counter rule
   */
  setFightOutcome: (
    roundId: string,
    moveId: string,
    to: string | null | undefined,
  ) => Promise<void>

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
   * True when the store is showing the walkthrough story.
   *
   * Every write returns here rather than calling the API. Letting them through
   * would fire requests at a story id no database has, and the walkthrough
   * would fill with red errors the moment anyone touched a field — which is
   * exactly the opposite of what it is for.
   */
  const readOnly = () => {
    if (!get().demo) return false
    set({ error: 'This is the walkthrough story — it lives in memory, so nothing here is saved.' })
    return true
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
  const write = async <K extends 'characters' | 'dialogue' | 'fights' | 'fightMoves' | 'fightRounds' | 'fightOutcomes'>(
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
    key: 'characters' | 'dialogue' | 'fights' | 'fightMoves' | 'fightRounds' | 'fightOutcomes',
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
    demo: false,

    clearError: () => set({ error: null }),
    canUndo: () => get().undoStack.length > 0,

    async loadStory(storyId) {
      // The walkthrough story is built in memory. No account, no network, and
      // therefore no writes — see `readOnly` below.
      if (storyId === DEMO_STORY_ID) {
        const graph = buildDemoStory()
        set({
          graph,
          derived: deriveGraph(graph),
          role: 'owner',
          currentNodeId: graph.story.root_node_id,
          trail: graph.story.root_node_id ? [graph.story.root_node_id] : [],
          undoStack: [],
          loading: false,
          error: null,
          demo: true,
        })
        return
      }

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
      //
      // `edgesTo`, not `parents` — principle 7. `parents` only holds edges that
      // carry a choice, so a room you reach by winning a fight had no way back
      // at all: retreating from it silently did nothing. The room view has
      // always listed that fight as a retreat, because it reads `edgesTo`.
      if (!derived || !currentNodeId) return
      const inbound = derived.edgesTo.get(currentNodeId) ?? []
      if (inbound.length > 0) {
        set({ currentNodeId: inbound[0].from_node_id, trail: [inbound[0].from_node_id] })
      }
    },

    /** F1.3 — tap a bricked arch to chisel through it: creates the node, wires
     *  the choice to it, and walks you in. */
    async createChildNode(fromChoiceId, title) {
      if (readOnly()) return null
      const { graph } = get()
      if (!graph) return null
      const choice = graph.choices.get(fromChoiceId)
      if (!choice) return null

      // The door's label names the SLUG and nothing else.
      //
      // It used to become the room's title too, which quietly made every door
      // and the room behind it the same thing: a door saying "enter the door"
      // left a room called "Enter The Door", and renaming either looked like it
      // had failed to take. They are separate pieces of writing — one is what
      // the caller hears at the threshold, the other is what the place is —
      // so the room is created unnamed and says so until somebody names it.
      //
      // The slug still follows the label, because a slug is an identifier: it
      // is the widget name in the exported flow and the filename in the bucket,
      // and ENTER_DOOR is far easier to find in either than ROOM_87.
      const label = title || choice.label || 'New room'
      const slug = uniqueSlug(
        label,
        [...graph.nodes.values()].map((n) => n.slug),
      )

      try {
        const node = await api.createNode(graph.story.id, {
          slug,
          // Only when a caller passed one deliberately; chiselling does not.
          title: title ?? '',
        })
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

    /**
     * Put a room on an existing door: A -> B becomes A -> new -> B.
     *
     * The exact inverse of collapse, and the thing you reach for when a beat is
     * missing between two rooms that are already joined.
     *
     * Built forwards — new room, then its way onward, and only then repoint the
     * original door. Repointing first would leave a dead end if either create
     * failed; this order's worst case is a stray orphan room, which the ledger
     * already reports and you can delete.
     */
    async insertRoomOnChoice(choiceId, title) {
      if (readOnly()) return null
      const { graph } = get()
      if (!graph) return null
      const choice = graph.choices.get(choiceId)
      if (!choice) return null
      // A door with nowhere to go is a chisel, not an insert — there is no
      // second room to reconnect to.
      const onward = choice.to_node_id
      if (!onward) {
        set({ error: 'That door leads nowhere yet. Chisel through it instead.' })
        return null
      }

      const name = title?.trim() || 'New room'
      const slug = uniqueSlug(
        name,
        [...graph.nodes.values()].map((n) => n.slug),
      )

      try {
        const node = await api.createNode(graph.story.id, { slug, title: name })
        const bridge = await api.createChoice(graph.story.id, {
          from_node_id: node.id,
          digit: '1',
          label: '',
          to_node_id: onward,
          sort_order: 1,
        })
        const rewired = await api.updateChoice(choiceId, { to_node_id: node.id })

        patchGraph((g) => ({
          ...g,
          nodes: new Map(g.nodes).set(node.id, node),
          choices: new Map(g.choices).set(bridge.id, bridge).set(rewired.id, rewired),
        }))
        // Walk in, the way chiselling does: you made it to write it, and the
        // header rename is right there.
        set((s) => ({ ...s, currentNodeId: node.id, trail: [...s.trail, node.id] }))

        pushUndo({
          label: `insert ${slug}`,
          invert: async () => {
            // Reconnect the original door first, so the graph is never missing
            // the link even for the moment the delete takes.
            await api.updateChoice(choiceId, { to_node_id: onward })
            await api.deleteNode(node.id)
          },
        })
        return node.id
      } catch (e) {
        fail(e)
        return null
      }
    },

    /**
     * Splice a room out and join the two either side (see room/collapse.ts).
     *
     * Repoint first, delete last: every inbound edge has to be looking at the
     * far room before this one goes, or the delete's ON DELETE SET NULL turns a
     * real way through the dungeon into a dead end. `refresh` afterwards rather
     * than a hand-written patch, because a collapse can touch choices, fights,
     * outcomes and nodes in one go and this is a once-per-room operation.
     */
    async updateStory(patch) {
      if (readOnly()) return
      const { graph } = get()
      if (!graph) return
      const before = graph.story
      patchGraph((g) => ({ ...g, story: { ...g.story, ...patch } }))
      try {
        const saved = await api.updateStory(before.id, patch)
        patchGraph((g) => ({ ...g, story: saved }))
        const inverse: Partial<Story> = {}
        for (const key of Object.keys(patch) as Array<keyof Story>) {
          inverse[key] = before[key] as never
        }
        pushUndo({ label: 'story settings', invert: () => api.updateStory(before.id, inverse).then(() => {}) })
      } catch (e) {
        // Roll the optimistic write back: the sheet must never claim a save
        // that the database refused.
        patchGraph((g) => ({ ...g, story: before }))
        fail(e)
      }
    },

    async setItemAudio(id, path, durationMs) {
      if (readOnly()) return
      const { graph } = get()
      if (!graph) return
      try {
        const saved = await api.updateStateVar(id, {
          audio_path: path,
          audio_duration_ms: durationMs,
        })
        patchGraph((g) => ({ ...g, stateVars: new Map(g.stateVars).set(saved.id, saved) }))
      } catch (e) {
        fail(e)
      }
    },

    async collapseRoom(nodeId) {
      if (readOnly()) return false
      const { graph, derived } = get()
      if (!graph || !derived) return false
      const check = planCollapse(graph, derived, nodeId)
      if (!check.ok) {
        set({ error: check.reason })
        return false
      }
      const { plan } = check
      const node = graph.nodes.get(nodeId)
      if (!node) return false
      const exits = derived.children.get(nodeId) ?? []

      try {
        for (const link of plan.inbound) {
          if (link.kind === 'choice') {
            await api.updateChoice(link.choiceId, {
              to_node_id: plan.toNodeId,
              ...(link.fillLabel ? { label: link.fillLabel } : {}),
            })
          } else if (link.kind === 'fight-move') {
            await api.upsertFightOutcome(graph.story.id, link.roundId, link.moveId, plan.toNodeId)
          } else {
            await api.updateFight(link.fightId, {
              [link.kind === 'fight-win' ? 'win_node_id' : 'lose_node_id']: plan.toNodeId,
            })
          }
        }
        for (const r of plan.redirects) {
          await api.updateNode(r.nodeId, { [r.field]: plan.toNodeId })
        }
        await api.deleteNode(nodeId)

        // Standing in a room that no longer exists: step forward to the room it
        // joined to, which is where the caller now goes.
        set((s) => ({
          ...s,
          currentNodeId: s.currentNodeId === nodeId ? plan.toNodeId : s.currentNodeId,
          trail: s.trail.filter((id) => id !== nodeId),
        }))
        await get().refresh()

        pushUndo({
          label: `collapse ${node.slug}`,
          invert: async () => {
            // The room comes back with a new id, so everything that pointed at
            // it has to be re-pointed at the new one — the same id remapping a
            // fight's undo does.
            const restored = await api.createNode(graph.story.id, {
              slug: node.slug,
              title: node.title,
              narration: node.narration,
              node_type: node.node_type,
              room_design: node.room_design,
              notes: node.notes,
              status: node.status,
              audio_path: node.audio_path,
              audio_duration_ms: node.audio_duration_ms,
              timeout_seconds: node.timeout_seconds,
              timeout_target_id: node.timeout_target_id,
              invalid_target_id: node.invalid_target_id,
            })
            for (const exit of exits) {
              await api.createChoice(graph.story.id, {
                from_node_id: restored.id,
                digit: exit.digit,
                label: exit.label,
                to_node_id: exit.to_node_id,
                sort_order: exit.sort_order,
              })
            }
            for (const link of plan.inbound) {
              if (link.kind === 'choice') {
                await api.updateChoice(link.choiceId, {
                  to_node_id: restored.id,
                  ...(link.fillLabel ? { label: '' } : {}),
                })
              } else if (link.kind === 'fight-move') {
                await api.upsertFightOutcome(
                  graph.story.id,
                  link.roundId,
                  link.moveId,
                  restored.id,
                )
              } else {
                await api.updateFight(link.fightId, {
                  [link.kind === 'fight-win' ? 'win_node_id' : 'lose_node_id']: restored.id,
                })
              }
            }
            for (const r of plan.redirects) {
              await api.updateNode(r.nodeId, { [r.field]: restored.id })
            }
          },
        })
        return true
      } catch (e) {
        fail(e)
        return false
      }
    },

    async addChoice(fromNodeId, digit, label = '') {
      if (readOnly()) return
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
      if (readOnly()) return
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
      if (readOnly()) return
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
      if (readOnly()) return
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
      if (readOnly()) return
      await write<'characters'>('characters', (g) => api.createCharacter(g.story.id, patch))
    },

    async editCharacter(id, patch) {
      if (readOnly()) return
      await write<'characters'>('characters', () => api.updateCharacter(id, patch))
    },

    async removeCharacter(id) {
      if (readOnly()) return
      // Deleting a character nulls the character_id on every line they spoke
      // (the FK is ON DELETE SET NULL), so the lines that survive have to be
      // re-read rather than guessed at.
      const { graph } = get()
      const before = graph?.characters.get(id)
      if (!graph || !before) return

      // Their lines survive with character_id nulled, so undo has to put the
      // attributions back as well as the cast entry.
      const spoken = [...graph.dialogue.values()].filter((l) => l.character_id === id)

      try {
        await api.deleteCharacter(id)
        await get().refresh()

        pushUndo({
          label: `remove ${before.name}`,
          invert: async () => {
            const made = await api.createCharacter(before.story_id, {
              slug: before.slug,
              name: before.name,
              is_playable: before.is_playable,
              voice_actor: before.voice_actor,
              color: before.color,
              notes: before.notes,
            })
            for (const line of spoken) {
              await api.updateDialogueLine(line.id, { character_id: made.id })
            }
          },
        })
      } catch (e) {
        fail(e)
      }
    },

    async saveDialogue(nodeId, lines) {
      if (readOnly()) return
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

    async setLineAudio(id, path, durationMs) {
      if (readOnly()) return
      await write<'dialogue'>('dialogue', () =>
        api.updateDialogueLine(id, { audio_path: path, audio_duration_ms: durationMs }),
      )
    },

    async addFight(nodeId) {
      if (readOnly()) return
      await write<'fights'>('fights', (g) => api.createFight(g.story.id, { node_id: nodeId }))
    },

    async editFight(id, patch) {
      if (readOnly()) return
      await write<'fights'>('fights', () => api.updateFight(id, patch))
    },

    async removeFight(id) {
      if (readOnly()) return
      const { graph } = get()
      const before = graph?.fights.get(id)
      if (!graph || !before) return

      // Everything hanging off the fight goes with it, so undo has to rebuild
      // all of it. Captured before the delete, because afterwards it is gone.
      const moves = [...graph.fightMoves.values()].filter((m) => m.fight_id === id)
      const rounds = [...graph.fightRounds.values()].filter((r) => r.fight_id === id)
      const outcomes = [...graph.fightOutcomes.values()].filter((o) => o.fight_id === id)

      try {
        await api.deleteFight(id)
        // Moves, rounds and outcomes cascade; refresh rather than model it.
        await get().refresh()

        pushUndo({
          label: `remove the ${before.opponent_name} fight`,
          invert: async () => {
            const fight = await api.createFight(before.story_id, {
              node_id: before.node_id,
              opponent_name: before.opponent_name,
              win_node_id: before.win_node_id,
              lose_node_id: before.lose_node_id,
              silence_patience: before.silence_patience,
            })
            // Recreating yields new ids, so the outcomes have to be re-pointed
            // at the rebuilt rows rather than restored verbatim.
            const moveIds = new Map<string, string>()
            for (const m of moves) {
              const made = await api.createFightMove(before.story_id, {
                fight_id: fight.id,
                slug: m.slug,
                label: m.label,
                beats: m.beats,
                sort_order: m.sort_order,
              })
              moveIds.set(m.id, made.id)
            }
            const roundIds = new Map<string, string>()
            for (const r of rounds) {
              const made = await api.createFightRound(before.story_id, {
                fight_id: fight.id,
                sort_order: r.sort_order,
                opponent_move: r.opponent_move,
                narration: r.narration,
                audio_path: r.audio_path,
                audio_duration_ms: r.audio_duration_ms,
              })
              roundIds.set(r.id, made.id)
            }
            for (const o of outcomes) {
              const round = roundIds.get(o.round_id)
              const move = moveIds.get(o.move_id)
              if (round && move) {
                await api.upsertFightOutcome(before.story_id, round, move, o.to_node_id)
              }
            }
          },
        })
      } catch (e) {
        fail(e)
      }
    },

    async addFightMove(fightId, slug) {
      if (readOnly()) return
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
      if (readOnly()) return
      await write<'fightMoves'>('fightMoves', () => api.updateFightMove(id, patch))
    },

    async removeFightMove(id) {
      if (readOnly()) return
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
      if (readOnly()) return
      const existing = [...(get().graph?.fightRounds.values() ?? [])].filter(
        (r) => r.fight_id === fightId,
      )
      await write<'fightRounds'>('fightRounds', (g) =>
        api.createFightRound(g.story.id, { fight_id: fightId, sort_order: existing.length }),
      )
    },

    async editFightRound(id, patch) {
      if (readOnly()) return
      await write<'fightRounds'>('fightRounds', () => api.updateFightRound(id, patch))
    },

    async removeFightRound(id) {
      if (readOnly()) return
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

    async setFightOutcome(roundId, moveId, to) {
      if (readOnly()) return
      const { graph } = get()
      if (!graph) return

      if (to === undefined) {
        const existing = [...graph.fightOutcomes.values()].find(
          (o) => o.round_id === roundId && o.move_id === moveId,
        )
        if (!existing) return
        try {
          await api.deleteFightOutcome(roundId, moveId)
          patchGraph((g) => {
            const fightOutcomes = new Map(g.fightOutcomes)
            fightOutcomes.delete(existing.id)
            return { ...g, fightOutcomes }
          })
        } catch (e) {
          fail(e)
        }
        return
      }

      await write<'fightOutcomes'>('fightOutcomes', (g) =>
        api.upsertFightOutcome(g.story.id, roundId, moveId, to),
      )
    },

    async refresh() {
      const { graph, currentNodeId, demo } = get()
      if (!graph || demo) return
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
