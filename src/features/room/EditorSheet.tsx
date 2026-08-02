import { useEffect, useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { estimateSeconds, isLongNarration, LONG_NARRATION_SECONDS } from '@/lib/speech'
import { slugify } from '@/lib/slug'
import { nextFreeDigit } from './roomModel'
import { isPlainRoom, roomKinds, type RoomKinds } from './roomKinds'
import { describeCollapse, planCollapse } from './collapse'
import { isPromptLine, promptsFor, withPrompts, type Joiner } from './prompts'
import AudioPanel from '@/features/audio/AudioPanel'
import ItemsSection from '@/features/state/ItemsSection'
import CollabPanel from '@/features/collab/CollabPanel'
import DialogueSection from '@/features/cast/DialogueSection'
import FightSection from '@/features/fight/FightSection'
import { ROOM_DESIGNS } from './vector/designs'
import { DIGITS, canWrite, type Digit, type StoryNode } from '@/types/domain'

/**
 * What this room does, as three boxes.
 *
 * They are not exclusive — a fight can grant an item — so "just doors" is the
 * state of having none of them ticked rather than a fourth box that would have
 * to fight the other three.
 *
 * Ticking reveals the section for that kind, and creates the row where there is
 * one row to create: a fight. Dialogue is revealed but never split
 * automatically, because the parser guesses and a wrong guess is much harder to
 * undo than to avoid. Unticking never quietly destroys work: a fight and a
 * split script are removable with a confirmation that says what is lost, and
 * items — which are spread across arrival effects, per-door effects and gates —
 * can only be hidden once you have cleared them yourself.
 */
function WhatHappensHere({
  kinds,
  shown,
  onChange,
  nodeId,
  slug,
}: {
  kinds: RoomKinds | null
  shown: RoomKinds
  onChange: (next: RoomKinds) => void
  nodeId: string
  slug: string
}) {
  const graph = useDelve((s) => s.graph)
  const addFight = useDelve((s) => s.addFight)
  const removeFight = useDelve((s) => s.removeFight)
  const saveDialogue = useDelve((s) => s.saveDialogue)
  if (!graph || !kinds) return null

  const fight = [...graph.fights.values()].find((f) => f.node_id === nodeId)
  const lineCount = [...graph.dialogue.values()].filter((l) => l.node_id === nodeId).length

  const set = (key: keyof RoomKinds, on: boolean) => onChange({ ...shown, [key]: on })

  const toggleDialogue = async (on: boolean) => {
    if (on) return set('dialogue', true)
    if (lineCount > 0) {
      const takes = [...graph.dialogue.values()].filter(
        (l) => l.node_id === nodeId && l.audio_path,
      ).length
      const ok = window.confirm(
        `Collapse ${lineCount} line${lineCount === 1 ? '' : 's'} back into one block of narration?` +
          `\n\nThe script itself is kept.` +
          (takes > 0
            ? `\n${takes} recorded line take${takes === 1 ? '' : 's'} will be lost.`
            : ''),
      )
      if (!ok) return
      await saveDialogue(nodeId, [])
    }
    set('dialogue', false)
  }

  const toggleFight = async (on: boolean) => {
    if (on) {
      if (!fight) await addFight(nodeId)
      return set('fight', true)
    }
    if (fight) {
      const rounds = [...graph.fightRounds.values()].filter((r) => r.fight_id === fight.id).length
      const ok = window.confirm(
        `Delete the fight in ${slug}?` +
          `\n\nIts ${rounds} round${rounds === 1 ? '' : 's'}, its moves and everything they point at go with it.` +
          `\nRooms only reachable by winning or losing will be left sealed.`,
      )
      if (!ok) return
      await removeFight(fight.id)
    }
    set('fight', false)
  }

  const boxes: Array<{
    key: keyof RoomKinds
    label: string
    hint: string
    on: boolean
    /** Content exists, so it cannot simply be hidden. */
    locked: boolean
    lockedWhy?: string
    toggle: (on: boolean) => void
  }> = [
    {
      key: 'dialogue',
      label: '🗣 Someone speaks',
      hint: 'Split the narration by who says it, so two actors can share the scene.',
      on: shown.dialogue || kinds.dialogue,
      locked: false,
      toggle: (on) => void toggleDialogue(on),
    },
    {
      key: 'items',
      label: '🎒 An item changes hands',
      hint: 'Give or take something on arrival or at a door, or lock a door behind one.',
      on: shown.items || kinds.items,
      locked: kinds.items,
      lockedWhy: 'This room already gives, takes or checks something. Clear it below to hide this.',
      toggle: (on) => set('items', on),
    },
    {
      key: 'fight',
      // Variation selector: the bare codepoint renders as a monochrome glyph that
      // reads as a ✕, i.e. "remove", next to a checkbox.
      label: '⚔️ There is a fight',
      hint: 'Rounds of keypresses instead of doors. Each round says where every key goes.',
      on: shown.fight || kinds.fight,
      locked: false,
      toggle: (on) => void toggleFight(on),
    },
  ]

  return (
    <div className="flex flex-col gap-2 rounded border border-mortar/40 p-3">
      <span className="text-xs uppercase tracking-wider text-mortar">What happens here</span>
      {boxes.map((b) => (
        <label key={b.key} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={b.on}
            disabled={b.locked && b.on}
            title={b.locked && b.on ? b.lockedWhy : undefined}
            onChange={(e) => b.toggle(e.target.checked)}
            className="mt-1 shrink-0 accent-torch"
          />
          <span className="min-w-0">
            <span className={b.on ? 'text-parchment' : 'text-mortar'}>{b.label}</span>
            <span className="block text-xs text-cold">
              {b.locked && b.on ? b.lockedWhy : b.hint}
            </span>
          </span>
        </label>
      ))}
      {isPlainRoom({
        dialogue: shown.dialogue || kinds.dialogue,
        items: shown.items || kinds.items,
        fight: shown.fight || kinds.fight,
      }) && (
        <p className="text-xs text-cold">
          Nothing ticked: the caller hears this room read out, then picks a door.
        </p>
      )}
    </div>
  )
}

/**
 * Splice this room out and join the two either side.
 *
 * The import turned every node in the source file into a room, including the
 * ones that were actions — "enter door" is a thing you do on the way through,
 * not somewhere you stand. Rather than delete and rewire by hand, collapse it.
 *
 * The button is always visible and explains itself when it can't be used: a
 * disabled control with no reason is worse than no control, and the reasons
 * here are all things the author can act on.
 */
function CollapseRoom({ nodeId, onCollapsed }: { nodeId: string; onCollapsed: () => void }) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const collapseRoom = useDelve((s) => s.collapseRoom)
  const [busy, setBusy] = useState(false)
  if (!graph || !derived) return null

  const node = graph.nodes.get(nodeId)
  if (!node) return null
  const check = planCollapse(graph, derived, nodeId)
  const roomName = node.title || node.slug

  const go = async () => {
    if (!check.ok) return
    if (!window.confirm(describeCollapse(check.plan, roomName))) return
    setBusy(true)
    const done = await collapseRoom(nodeId)
    setBusy(false)
    // The room is gone, so the sheet editing it has to go with it.
    if (done) onCollapsed()
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-mortar/40 p-3">
      <span className="text-xs uppercase tracking-wider text-mortar">Collapse this room</span>
      <p className="text-xs text-cold">
        {check.ok
          ? `Remove it and send everything that leads here straight to ${check.plan.toTitle}. For nodes that were really actions — "enter door" — rather than places.`
          : check.reason}
      </p>
      <button
        type="button"
        disabled={!check.ok || busy}
        onClick={() => void go()}
        className="self-start rounded border border-grave/60 px-3 py-2 text-xs text-grave hover:border-grave disabled:opacity-40"
      >
        {busy ? 'Collapsing…' : `Collapse into ${check.ok ? check.plan.toTitle : '—'}`}
      </button>
    </div>
  )
}

/**
 * §4.2 — slides up over the room, ~70% height. Autosave on blur (F2.2); there is
 * deliberately no save button.
 */
export default function EditorSheet({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const role = useDelve((s) => s.role)
  const updateNode = useDelve((s) => s.updateNode)
  const updateChoice = useDelve((s) => s.updateChoice)
  const addChoice = useDelve((s) => s.addChoice)
  const deleteChoice = useDelve((s) => s.deleteChoice)
  const insertRoomOnChoice = useDelve((s) => s.insertRoomOnChoice)
  const saveDialogue = useDelve((s) => s.saveDialogue)

  const node = graph?.nodes.get(nodeId)
  const editable = canWrite(role)

  // Local draft so typing stays responsive; committed to the store on blur.
  const [draft, setDraft] = useState<Partial<StoryNode>>({})
  useEffect(() => setDraft({}), [nodeId])

  const value = <K extends keyof StoryNode>(key: K): StoryNode[K] =>
    (draft[key] ?? node?.[key]) as StoryNode[K]

  const commit = <K extends keyof StoryNode>(key: K) => {
    if (!node) return
    const next = draft[key]
    if (next === undefined || next === node[key]) return
    void updateNode(node.id, { [key]: next } as Partial<StoryNode>)
  }

  const outgoing = useMemo(
    () => (derived && node ? (derived.children.get(node.id) ?? []) : []),
    [derived, node],
  )

  // Inserting walks you into the new room. The sheet is keyed on the store's
  // current node, so it follows automatically — you land with the editor open
  // and the header rename one tap away.
  const insert = async (choiceId: string) => {
    await insertRoomOnChoice(choiceId)
  }

  const [announcing, setAnnouncing] = useState(false)
  const prompts = useMemo(
    () => (graph && derived && node ? promptsFor(graph, derived, node.id, 'for') : []),
    [graph, derived, node],
  )
  // A labelled door with nowhere to go still gets announced — the author asked
  // for it by writing a label, and dropping it silently would hide the work.
  // Saying so is the honest middle: on the phone that key does nothing yet.
  const announcedButUnwired = outgoing.filter((c) => !c.to_node_id && c.label.trim()).length

  /**
   * Write the door prompts into the room's text.
   *
   * A room split into lines keeps its narration composed FROM those lines
   * (principle 8), so writing to `narration` there would be undone by the next
   * line edit. One prompt per line is also the faithful shape: composeNarration
   * joins on newlines, so a single multi-line entry would not survive the
   * round-trip — and this way each prompt can carry its own take.
   */
  const announce = async (joiner: Joiner) => {
    if (!graph || !derived || !node) return
    const next = promptsFor(graph, derived, node.id, joiner)
    setAnnouncing(true)
    const lines = [...graph.dialogue.values()]
      .filter((l) => l.node_id === node.id)
      .sort((a, b) => a.sort_order - b.sort_order)

    if (lines.length > 0) {
      const kept = [...lines]
      while (kept.length > 0) {
        const last = kept[kept.length - 1]
        if (last.character_id === null && isPromptLine(last.text)) kept.pop()
        else break
      }
      await saveDialogue(node.id, [
        ...kept.map((l) => ({
          character_id: l.character_id,
          text: l.text,
          audio_path: l.audio_path,
          audio_duration_ms: l.audio_duration_ms,
        })),
        ...next.map((text) => ({
          character_id: null,
          text,
          audio_path: null,
          audio_duration_ms: null,
        })),
      ])
    } else {
      const text = withPrompts(String(value('narration') ?? ''), next)
      setDraft((d) => ({ ...d, narration: text }))
      await updateNode(node.id, { narration: text })
    }
    setAnnouncing(false)
  }

  // What this room already does, read off the graph rather than off a stored
  // flag. `shown` starts from that and is what the checkboxes drive: a room can
  // be opted into dialogue or items before it has any, and a kind that already
  // has content can't be hidden without deleting the content first.
  const kinds = useMemo(
    () => (graph && derived && node ? roomKinds(graph, derived, node.id) : null),
    [graph, derived, node],
  )
  const [shown, setShown] = useState<RoomKinds>({ dialogue: false, items: false, fight: false })
  useEffect(() => {
    if (kinds) setShown(kinds)
    // Re-read when you walk to another room, not on every graph tick — otherwise
    // a box you just ticked would snap back the moment anything else saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const slugTaken = useMemo(() => {
    if (!graph || !node) return false
    const candidate = String(value('slug') ?? '')
    return [...graph.nodes.values()].some((n) => n.id !== node.id && n.slug === candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, node, draft.slug])

  if (!node || !graph || !derived) return null

  const narration = String(value('narration') ?? '')
  const seconds = estimateSeconds(narration)

  const field = 'w-full rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60'

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm text-torch">Edit room</h3>
        <button onClick={onClose} className="text-sm text-mortar underline">
          Done
        </button>
      </div>

      {/* Audio sits outside the disabled fieldset: the `voice` role can record
          even though every story field below is read-only for them. */}
      <AudioPanel nodeId={nodeId} />

      {/* Also outside the fieldset: `voice` and `viewer` may leave notes, and a
          voice actor claiming a room to record is exactly the point of F9.4. */}
      <CollabPanel nodeId={nodeId} />

      {!editable && (
        <p className="mb-4 rounded border border-cold/60 bg-cold/10 p-3 text-xs">
          You have the <strong>{role ?? 'viewer'}</strong> role, so the story text is read-only.
          {role === 'voice' && ' You can still record audio and set status.'}
        </p>
      )}

      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Title</span>
          <input
            className={field}
            placeholder={node.slug}
            value={String(value('title') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onBlur={() => commit('title')}
          />
          <span className="text-xs text-cold">
            Carved on the wall here, and shown on every door that leads to this room. Short names
            read best — a long one gets trimmed on the doors. You can also tap the name in the
            header to rename without opening this.
          </span>
        </label>

        <WhatHappensHere
          kinds={kinds}
          shown={shown}
          onChange={setShown}
          nodeId={nodeId}
          slug={node.slug}
        />

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs uppercase tracking-wider text-mortar">
            <span>Narration</span>
            {/* F2.7 — live estimate, warn past 15s. */}
            <span className={isLongNarration(narration) ? 'text-grave' : 'text-mortar'}>
              {narration.length} chars · ~{seconds}s
              {isLongNarration(narration) && ` · over ${LONG_NARRATION_SECONDS}s`}
            </span>
          </span>
          <textarea
            rows={5}
            className={field}
            value={narration}
            onChange={(e) => setDraft((d) => ({ ...d, narration: e.target.value }))}
            onBlur={() => commit('narration')}
          />
        </label>

        {/* The doors, as the words that offer them. Press it again after editing
            a label: it replaces the block it wrote rather than stacking a
            second copy, so the script never drifts from the graph. */}
        <div className="flex flex-col gap-2 rounded border border-mortar/40 p-3">
          <span className="text-xs uppercase tracking-wider text-mortar">Announce the doors</span>
          <p className="text-xs text-cold">
            {prompts.length === 0
              ? 'No doors to announce — label this room’s exits first.'
              : `Adds ${prompts.length} line${prompts.length === 1 ? '' : 's'} to the end of the text. Press again after changing a label and it rewrites them.${
                  announcedButUnwired > 0
                    ? ` ${announcedButUnwired} of them lead${announcedButUnwired === 1 ? 's' : ''} nowhere yet, so that key does nothing on the phone until you build it.`
                    : ''
                }`}
          </p>
          <div className="flex flex-wrap gap-2">
            {(['for', 'to'] as const).map((joiner) => (
              <button
                key={joiner}
                type="button"
                disabled={prompts.length === 0 || announcing}
                onClick={() => void announce(joiner)}
                // The button *is* the preview: which preposition suits depends
                // on whether the labels are nouns or verbs, and only the author
                // knows that.
                title={promptsFor(graph, derived, nodeId, joiner)[0]}
                className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
              >
                {promptsFor(graph, derived, nodeId, joiner)[0] ?? `Press 1 ${joiner} …`}
              </button>
            ))}
          </div>
        </div>

        {(shown.dialogue || kinds?.dialogue) && <DialogueSection nodeId={nodeId} />}

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-mortar">Exits</span>
          <p className="text-xs text-cold">
            ⤵ puts a new room on a door, between here and where it goes. The door keeps its label,
            the new room gets the way onward, and you land in it ready to write.
          </p>
          {outgoing.length === 0 && <p className="text-xs text-cold">No exits yet.</p>}
          {outgoing.map((choice) => (
            <div key={choice.id} className="flex items-center gap-2">
              <select
                value={choice.digit}
                onChange={(e) => void updateChoice(choice.id, { digit: e.target.value as Digit })}
                className="rounded border border-mortar/60 bg-stone px-2 py-2"
              >
                {DIGITS.map((d) => {
                  // F2.5 — a digit already used by a sibling can't be picked.
                  const taken = outgoing.some((c) => c.id !== choice.id && c.digit === d)
                  return (
                    <option key={d} value={d} disabled={taken}>
                      {d}
                      {taken ? ' (used)' : ''}
                    </option>
                  )
                })}
              </select>
              <input
                defaultValue={choice.label}
                placeholder="Grab the harpoon"
                onBlur={(e) =>
                  e.target.value !== choice.label &&
                  void updateChoice(choice.id, { label: e.target.value })
                }
                className={field}
              />
              {/* F2.4 — destination picker: an existing node, or leave unwritten. */}
              <select
                value={choice.to_node_id ?? ''}
                onChange={(e) =>
                  void updateChoice(choice.id, { to_node_id: e.target.value || null })
                }
                className="max-w-[9rem] rounded border border-mortar/60 bg-stone px-2 py-2 text-xs"
              >
                <option value="">— unwritten —</option>
                {[...graph.nodes.values()]
                  .sort((a, b) => a.slug.localeCompare(b.slug))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.slug}
                    </option>
                  ))}
              </select>
              {/* The inverse of collapse, on the door it applies to: put a room
                  between here and wherever this goes. Disabled on an unwired
                  door, where the operation is a chisel and already exists. */}
              <button
                onClick={() => void insert(choice.id)}
                disabled={!choice.to_node_id}
                title={
                  choice.to_node_id
                    ? `Insert a room between ${node.slug} and ${
                        graph.nodes.get(choice.to_node_id)?.slug ?? 'there'
                      }`
                    : 'This door leads nowhere yet — chisel through it from the room instead'
                }
                className="px-2 text-mortar disabled:opacity-30"
              >
                ⤵
              </button>
              <button
                onClick={() => void deleteChoice(choice.id)}
                title="Remove exit"
                className="px-2 text-grave"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const digit = nextFreeDigit(derived, node.id)
              if (digit) void addChoice(node.id, digit)
            }}
            className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch"
          >
            + Add exit
          </button>
        </div>

        {(shown.fight || kinds?.fight) && <FightSection nodeId={nodeId} />}

        {(shown.items || kinds?.items) && <ItemsSection nodeId={nodeId} />}

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-mortar">Room design</span>
          <p className="text-xs text-cold">
            What kind of place this is. Changes the walls only — the torch, the archways and
            everything else still mean exactly what they meant.
          </p>
          <div className="flex flex-wrap gap-1">
            {ROOM_DESIGNS.map((design) => {
              const on = (value('room_design') || 'stone') === design.id
              return (
                <button
                  key={design.id}
                  title={design.blurb}
                  onClick={() => void updateNode(node.id, { room_design: design.id })}
                  className={[
                    'rounded border px-2 py-1 text-xs',
                    on ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
                  ].join(' ')}
                >
                  {design.name}
                </button>
              )
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Node type</span>
          <select
            className={field}
            value={String(value('node_type'))}
            onChange={(e) => {
              const node_type = e.target.value as StoryNode['node_type']
              // F2.6 — converting to an ending strands whatever hung off it.
              if (node_type === 'ending' && outgoing.length > 0) {
                const ok = window.confirm(
                  `${node.slug} has ${outgoing.length} exit(s). Endings are read then hung up on, so those exits will never be offered. Convert anyway?`,
                )
                if (!ok) return
              }
              setDraft((d) => ({ ...d, node_type }))
              void updateNode(node.id, { node_type })
            }}
          >
            <option value="room">Room</option>
            <option value="ending">Ending</option>
          </select>
        </label>

        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-mortar">
            Timeout &amp; invalid keypress
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-mortar">Seconds to wait</span>
              <input
                type="number"
                min={1}
                max={60}
                className={field}
                value={Number(value('timeout_seconds') ?? 5)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, timeout_seconds: Number(e.target.value) }))
                }
                onBlur={() => commit('timeout_seconds')}
              />
            </label>
            {(['timeout_target_id', 'invalid_target_id'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-mortar">
                  {key === 'timeout_target_id' ? 'On silence' : 'On wrong keypress'}
                </span>
                <select
                  className={field}
                  value={String(value(key) ?? '')}
                  onChange={(e) => void updateNode(node.id, { [key]: e.target.value || null })}
                >
                  <option value="">Repeat this room</option>
                  {[...graph.nodes.values()].map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.slug}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">
            Production notes <span className="normal-case">(not heard by the caller)</span>
          </span>
          <textarea
            rows={2}
            className={field}
            value={String(value('notes') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            onBlur={() => commit('notes')}
          />
        </label>

        <CollapseRoom nodeId={nodeId} onCollapsed={onClose} />

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Slug</span>
          <input
            className={field}
            value={String(value('slug') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
            onBlur={() => !slugTaken && commit('slug')}
          />
          {slugTaken && <span className="text-xs text-grave">Another room already uses that slug.</span>}
        </label>
      </fieldset>
    </div>
  )
}
