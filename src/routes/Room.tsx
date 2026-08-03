import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { buildRoomView, type ExitView } from '@/features/room/roomModel'
import { slotsToHideNewDoor } from '@/features/room/keys'
import RoomStage from '@/features/room/RoomStage'
import ReactionSheet from '@/features/room/ReactionSheet'
import ForkSheet from '@/features/room/ForkSheet'
import OfferedSheet from '@/features/room/OfferedSheet'
import ReactionGate from '@/features/room/ReactionGate'
import LoopBackSheet from '@/features/room/LoopBackSheet'
import EditorSheet from '@/features/room/EditorSheet'
import Automap from '@/features/automap/Automap'
import { useAutomapLayout } from '@/features/automap/useAutomapLayout'
import SatchelPanel from '@/features/state/SatchelPanel'
import { useSolver } from '@/features/state/useSolver'
import { usePresence } from '@/features/collab/usePresence'
import { useOfflineSync } from '@/features/offline/useOfflineSync'
import { errorText } from '@/lib/errorText'

export default function Room() {
  const { storyId } = useParams<{ storyId: string }>()
  const {
    graph,
    derived,
    currentNodeId,
    loading,
    error,
    loadStory,
    walkTo,
    retreat,
    createChildNode,
    updateNode,
    updateChoice,
    undo,
    clearError,
  } = useDelve()
  const undoStack = useDelve((s) => s.undoStack)
  const trailLength = useDelve((s) => s.trail.length)
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [choosingRetreat, setChoosingRetreat] = useState(false)
  /** Which door's reaction is open, if any. */
  const [reacting, setReacting] = useState<string | null>(null)
  /** Which door is having its fork set up. */
  const [forking, setForking] = useState<string | null>(null)
  /** Which door is having its "when is this offered?" question answered. */
  const [offering, setOffering] = useState<string | null>(null)
  /** A door being walked through that has something to be heard first. */
  const [passing, setPassing] = useState<{ choiceId: string; toId: string } | null>(null)
  /** Which door is being pointed at a room, from the doors panel. */
  const [wiring, setWiring] = useState<string | null>(null)
  /**
   * Which state of the room is being stood in — a reading id, null for the room
   * as written, or 'all' for every door at once.
   *
   * Reset on walking somewhere, because a state belongs to a room: "Has the
   * lamp" means nothing three rooms later, and carrying the selection would
   * silently hide doors in a room that never had a reading by that name.
   */
  const [viewingState, setViewingState] = useState<string | null | 'all'>('all')
  useEffect(() => setViewingState('all'), [currentNodeId])
  /** Door-visibility writes go straight to the API rather than through the
   *  store, so they need somewhere of their own to fail into. */
  const [doorError, setDoorError] = useState<string | null>(null)
  const { layout } = useAutomapLayout()
  const { result: solverResult, solving } = useSolver()
  const [satchelOpen, setSatchelOpen] = useState(false)
  const peers = usePresence(storyId, currentNodeId)
  const { queued, syncing } = useOfflineSync()

  // Load only when this is a story we don't already have.
  //
  // Reloading unconditionally meant every arrival at this screen reset
  // `currentNodeId` to the entrance — so F4.3's tap-a-room-to-teleport walked
  // you back to the front door a moment after it put you where you asked for,
  // and so did every trip out to the map, the ledger or the cast and back.
  // Comparing ids still reloads properly when you switch stories.
  useEffect(() => {
    if (storyId && graph?.story.id !== storyId) void loadStory(storyId)
  }, [storyId, graph?.story.id, loadStory])

  if (loading) return <p className="p-6 text-mortar">Lighting a torch…</p>
  if (!graph || !derived || !currentNodeId) {
    return (
      <main className="p-6">
        <p className="text-grave">{error ?? 'Story not found.'}</p>
        <Link to="/" className="text-sm underline">
          Back
        </Link>
      </main>
    )
  }

  const view = buildRoomView(graph, derived, currentNodeId, viewingState)
  if (!view) return <p className="p-6">This room has collapsed.</p>

  // A door carrying a reaction stops you on the way through, so what is heard
  // between the two rooms gets heard. An ordinary door walks straight on.
  const onEnter = (exit: ExitView) => {
    if (!exit.targetId) return
    if (exit.reaction !== 'none' && exit.choiceId) {
      setPassing({ choiceId: exit.choiceId, toId: exit.targetId })
      return
    }
    walkTo(exit.targetId)
  }

  // F1.11 — cycle through rooms sharing this one's parent.
  const onCycleSibling = (direction: 1 | -1) => {
    const here = view.siblings.indexOf(currentNodeId)
    if (here === -1 || view.siblings.length < 2) return
    const next = (here + direction + view.siblings.length) % view.siblings.length
    walkTo(view.siblings[next])
  }

  // F1.12 — more than one way back means a fork in the retreat path, so ask
  // rather than guessing. One parent retreats straight away.
  const onRetreat = () => {
    if (view.retreats.length > 1 && useDelve.getState().trail.length <= 1) {
      setChoosingRetreat(true)
      return
    }
    retreat()
  }
  // Either there is a trail to walk back down, or the graph itself has a way in.
  const canRetreat = trailLength > 1 || view.retreats.length > 0

  /**
   * Offer or withhold a door in the state being stood in.
   *
   * Only ever the CURRENT state — there is no way to reach another room's rules
   * from here, and no way to change 'all', which is not a state a caller can be
   * in. Written straight through and re-read, like everything else that hangs
   * off a reading.
   */
  const setDoorShown = async (choiceId: string, shown: boolean) => {
    if (viewingState === 'all') return
    setDoorError(null)
    try {
      await api.setDoorHidden(graph.story.id, choiceId, viewingState, !shown)
      await useDelve.getState().refresh()
    } catch (e) {
      setDoorError(errorText(e))
    }
  }

  /** Point a door at an existing room, making the door first if need be. */
  const openWiring = async (digit: string) => {
    // Only a door THIS state offers counts as already there: a key whose door
    // is hidden here is free here, and wiring it makes a second one.
    const existing = view.exits
      .concat(view.overflowExits)
      .find((e) => e.digit === digit && e.choiceId)
    if (existing?.choiceId) return setWiring(existing.choiceId)
    const made = await makeDoor(digit as ExitView['digit'])
    if (made) setWiring(made)
  }

  const onChisel = async (exit: ExitView) => {
    if (exit.choiceId) {
      await createChildNode(exit.choiceId)
      return
    }
    // An empty wall slot: make the archway, then chisel through it.
    const made = await makeDoor(exit.digit)
    if (made) await createChildNode(made)
  }

  /**
   * Put a door on a key, and make it belong to the state you are standing in.
   *
   * A key free in THIS state may already carry a door in another one — that is
   * how "press 2 means something different with the crowbar" gets built. The
   * new door is therefore hidden everywhere except here, because the other
   * states already have their answer for that key and a second visible door
   * would make only the first reachable.
   *
   * A key free everywhere gets no rows at all, which is the ordinary case and
   * has to stay "offered in every state".
   */
  const makeDoor = async (digit: ExitView['digit']): Promise<string | null> => {
    const before = new Set((derived.children.get(currentNodeId) ?? []).map((c) => c.id))
    const hideIn = slotsToHideNewDoor(graph, currentNodeId, digit, viewingState)
    await useDelve.getState().addChoice(currentNodeId, digit)
    const fresh = useDelve.getState().derived?.children.get(currentNodeId) ?? []
    const created = fresh.find((c) => c.digit === digit && !before.has(c.id))
    if (!created) return null
    if (hideIn.length > 0) {
      try {
        for (const slot of hideIn) {
          await api.setDoorHidden(graph.story.id, created.id, slot, true)
        }
        await useDelve.getState().refresh()
      } catch (e) {
        setDoorError(errorText(e))
      }
    }
    return created.id
  }

  return (
    <main className="flex min-h-full flex-col">
      {/* Wraps on a phone: seven links and a room name do not fit on one 390px
          row, and the thing that lost was the room name — squeezed to a single
          letter. The nav takes its own line there and sits inline from sm up. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-mortar/40 px-4 py-3 text-sm">
        {/* Named, now that the footer also has a back button: this one leaves
            the story, that one walks back a room. */}
        <Link to="/" className="shrink-0 text-mortar underline">
          Stories
        </Link>
        {/* Tap to rename. The title is what the door plates show, so needing to
            open the editor and scroll to reach it made the one field you most
            want to fix the hardest to get at. Falls back to the slug when the
            room is untitled, which is what the walls do too. */}
        {renaming ? (
          <input
            autoFocus
            defaultValue={view.node.title ?? ''}
            placeholder={view.node.slug}
            aria-label={`Rename ${view.node.slug}`}
            onBlur={(e) => {
              const title = e.target.value.trim()
              if (title !== (view.node.title ?? '')) void updateNode(view.node.id, { title })
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              // Escape abandons the edit: blur without the change reaching the store.
              if (e.key === 'Escape') {
                e.currentTarget.value = view.node.title ?? ''
                e.currentTarget.blur()
              }
            }}
            className="min-w-0 flex-1 rounded border border-torch bg-stone px-2 py-1 font-paper text-torch outline-none"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            title={view.node.title ? 'Rename this room' : 'This room has no name yet — tap to name it'}
            className={[
              'min-w-0 truncate font-paper underline decoration-dotted underline-offset-4',
              // An unnamed room falls back to its slug, which is an identifier
              // and not a name. Showing it in the same gold as a real title
              // would read as "this room is called ENTER_DOOR" — which, for a
              // room chiselled through a door, is exactly the confusion worth
              // avoiding.
              view.node.title ? 'text-torch' : 'text-mortar',
            ].join(' ')}
          >
            {view.node.title || `${view.node.slug} — name it`}
          </button>
        )}
        <nav className="flex w-full shrink-0 gap-3 overflow-x-auto sm:ml-auto sm:w-auto sm:pr-16">
          <button
            onClick={() => void undo()}
            disabled={undoStack.length === 0}
            title={undoStack[undoStack.length - 1]?.label}
            className="text-mortar underline disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={() => setSatchelOpen(true)}
            title="What the caller could be carrying here"
            aria-label="Open the satchel"
            className="text-mortar"
          >
            🎒
          </button>
          <Link to={`/story/${storyId}/map`} className="text-mortar underline">
            Map
          </Link>
          <Link to={`/story/${storyId}/cast`} className="text-mortar underline">
            Cast
          </Link>
          {/* The long job, given a door of its own: 139 rooms is not something
              you record by walking to each one. */}
          <Link to={`/story/${storyId}/record`} className="text-torch underline">
            Record
          </Link>
          <Link to={`/story/${storyId}/playtest`} className="text-mortar underline">
            Dial in
          </Link>
          <Link to={`/story/${storyId}/tidy`} className="text-mortar underline">
            Tidy
          </Link>
          <Link to={`/story/${storyId}/ledger`} className="text-mortar underline">
            Ledger
          </Link>
          <Link to={`/story/${storyId}/export`} className="text-mortar underline">
            Export
          </Link>
        </nav>
      </header>

      {useDelve.getState().demo && (
        <p className="border-b border-torch/40 bg-torch/10 px-4 py-2 text-xs">
          Walkthrough story — it lives in memory, so nothing you change here is saved. Every screen
          is the real one.
        </p>
      )}

      {queued > 0 && (
        <p className="border-b border-cold/50 bg-cold/10 px-4 py-2 text-xs">
          {queued} edit{queued === 1 ? '' : 's'} waiting for signal
          {syncing ? ' · syncing…' : ' · they\'ll sync when you\'re back online'}
        </p>
      )}

      {/* F9.5 — a soft lock: it tells you someone is here, it doesn't stop you. */}
      {peers.some((p) => p.nodeId === currentNodeId) && (
        <p className="border-b border-torch/40 bg-torch/10 px-4 py-2 text-xs">
          {peers
            .filter((p) => p.nodeId === currentNodeId)
            .map((p) => p.email)
            .join(', ')}{' '}
          {peers.filter((p) => p.nodeId === currentNodeId).length === 1 ? 'is' : 'are'} in this room
          too.
        </p>
      )}

      {(view.isOrphan || view.isUnreachable || view.endingWithExits) && (
        <p className="border-b border-grave/40 bg-grave/10 px-4 py-2 text-xs">
          {view.isUnreachable && 'No path from the entrance reaches this room. '}
          {view.isOrphan && 'Nothing leads here. '}
          {view.endingWithExits && 'This is an ending, so its exits will never be offered.'}
          {view.fightWithExits &&
            'This room is a fight, so its doors will never be offered — the fight decides where the caller goes.'}
        </p>
      )}

      <RoomStage
        view={view}
        onEnter={onEnter}
        onChisel={onChisel}
        onRetreat={onRetreat}
        onCycleSibling={onCycleSibling}
        onWalk={walkTo}
        onRelabelExit={(choiceId, label) => void updateChoice(choiceId, { label })}
        /* Renames a room you are not standing in — the one behind the door. */
        onRenameTarget={(id, title) => void updateNode(id, { title })}
        /* Reaching a door's reaction from the doorway rather than the editor:
           this is where you are standing when you decide it needs one. */
        onReact={setReacting}
        /* One key, two rooms — beside the destination it splits. */
        onFork={setForking}
        /* When a door is offered at all — one control over what used to be a
           hide gate in the Items tab and a checkbox grid in the readings. */
        onOffered={setOffering}
        /* A digit, not a choice: the blank arch has no choice row yet, and it
           is the one that most needs sending back. Making the row here rather
           than inside the picker means cancelling leaves an unlabelled bricked
           door — which is what that wall slot already was, so nothing is worse
           off than before the tap. */
        onWire={(digit) => void openWiring(digit)}
        /* Stand in the room as one kind of caller. Kept on the route rather
           than in the stage so it survives opening the editor — the reason to
           switch states is usually to edit that state's doors. */
        onViewState={setViewingState}
        onSetDoorShown={(choiceId, shown) => void setDoorShown(choiceId, shown)}
      />

      {forking && <ForkSheet choiceId={forking} onClose={() => setForking(null)} />}

      {offering && <OfferedSheet choiceId={offering} onClose={() => setOffering(null)} />}

      {wiring && (() => {
        const c = graph.choices.get(wiring)
        if (!c) return null
        return (
          <LoopBackSheet
            fromNodeId={c.from_node_id}
            currentId={c.to_node_id}
            heading={`Pressing ${c.digit}${c.label ? ` — ${c.label}` : ''} leads to…`}
            blurb="Pointing a door at a room the caller has already passed is how a middle keeps looping while its other doors go on to an ending."
            wayHint="Wiring a door to one of these makes a loop — the caller can come round again."
            clearLabel="Unwire — leave this door bricked"
            onPick={(id) => void updateChoice(c.id, { to_node_id: id })}
            onClose={() => setWiring(null)}
          />
        )
      })()}

      {reacting && <ReactionSheet choiceId={reacting} onClose={() => setReacting(null)} />}

      {passing && (
        <ReactionGate
          choiceId={passing.choiceId}
          onCancel={() => setPassing(null)}
          onContinue={() => {
            const { toId } = passing
            setPassing(null)
            walkTo(toId)
          }}
        />
      )}

      {/* F1.12 — the retreat chooser. */}
      {choosingRetreat && (
        <div className="fixed inset-0 z-30 flex items-end bg-depth/80 p-4">
          <div className="w-full rounded-t-2xl border-t border-mortar bg-depth p-4">
            <h3 className="mb-3 text-sm text-torch">Several ways back from here</h3>
            <ul className="flex flex-col gap-2">
              {view.retreats.map((r) => (
                <li key={r.edgeId}>
                  <button
                    onClick={() => {
                      setChoosingRetreat(false)
                      walkTo(r.fromId)
                    }}
                    className="w-full rounded border border-mortar/60 px-3 py-3 text-left hover:border-torch"
                  >
                    {r.fromTitle}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setChoosingRetreat(false)}
              className="mt-3 w-full text-sm text-mortar underline"
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      <footer className="flex items-center gap-3 border-t border-mortar/40 p-4">
        {/* F1.4's retreat was swipe-right and nothing else, which is unusable
            with a mouse and undiscoverable on a phone. The swipe still works. */}
        <button
          onClick={onRetreat}
          disabled={!canRetreat}
          title={
            canRetreat ? 'Back to the room you came from' : 'Nothing leads here to go back to'
          }
          className="shrink-0 rounded border border-mortar/60 px-4 py-3 font-carved uppercase tracking-[0.12em] text-mortar disabled:opacity-40"
        >
          ◄ Back
        </button>

        <button
          onClick={() => setEditing((v) => !v)}
          className="flex-1 rounded bg-torch px-4 py-3 font-carved uppercase tracking-[0.12em] text-depth"
        >
          ✎ Edit
        </button>

        {/* F4.2 — a 120x120 minimap thumbnail; tap to expand. */}
        {layout && (
          <Link
            to={`/story/${storyId}/map`}
            aria-label="Open the automap"
            className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded border border-mortar/60"
          >
            <Automap layout={layout} currentId={currentNodeId} onTeleport={() => {}} thumbnail />
          </Link>
        )}
      </footer>

      {(error || doorError) && (
        <div className="fixed inset-x-4 bottom-24 z-30 rounded border border-grave bg-grave/20 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span>{error ?? doorError}</span>
            <button
              onClick={() => {
                setDoorError(null)
                clearError()
              }}
              className="underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {satchelOpen && (
        <SatchelPanel
          nodeId={currentNodeId}
          result={solverResult}
          solving={solving}
          onClose={() => setSatchelOpen(false)}
        />
      )}

      {editing && <EditorSheet nodeId={currentNodeId} viewing={viewingState} onClose={() => setEditing(false)} />}
    </main>
  )
}
