import { useDelve } from '@/features/graph/store'
import { slugify } from '@/lib/slug'
import { canWrite } from '@/types/domain'
import { buildFightView, counterFor, MAX_FIGHT_MOVES } from './model'

/**
 * The fight editor, inside the room's sheet (§4.2).
 *
 * Two tables and two destinations. The moves table says what the caller can do
 * and what each move beats; the rounds table says what the opponent does, in
 * order. The right answer to a round is never typed twice — it is looked up by
 * matching `beats` against the announced move, and shown back so a mismatch is
 * visible immediately rather than at the end of a playtest.
 */
export default function FightSection({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const addFight = useDelve((s) => s.addFight)
  const editFight = useDelve((s) => s.editFight)
  const removeFight = useDelve((s) => s.removeFight)
  const addFightMove = useDelve((s) => s.addFightMove)
  const editFightMove = useDelve((s) => s.editFightMove)
  const removeFightMove = useDelve((s) => s.removeFightMove)
  const addFightRound = useDelve((s) => s.addFightRound)
  const editFightRound = useDelve((s) => s.editFightRound)
  const removeFightRound = useDelve((s) => s.removeFightRound)

  if (!graph) return null
  const editable = canWrite(role)
  const view = buildFightView(graph, nodeId)

  const field =
    'w-full rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60'
  const rooms = [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))

  if (!view) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-mortar">Fight</span>
        <p className="text-xs text-cold">
          A fight replaces this room&apos;s doors. The narration still plays as the lead-in, then
          the opponent announces a move each round and the caller must press the move that counters
          it. One wrong answer ends it.
        </p>
        <button
          disabled={!editable}
          onClick={() => void addFight(nodeId)}
          className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
        >
          Make this room a fight
        </button>
      </div>
    )
  }

  const { fight, moves, rounds } = view

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs uppercase tracking-wider text-mortar">Fight</span>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-mortar">Opponent</span>
        <input
          disabled={!editable}
          className={field}
          defaultValue={fight.opponent_name}
          onBlur={(e) =>
            e.target.value !== fight.opponent_name &&
            void editFight(fight.id, { opponent_name: e.target.value })
          }
        />
      </label>

      {/* Moves. The digit is the row's position, so reordering is renaming. */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-mortar">Moves — the digit is the row number</span>
        {moves.map((move, i) => (
          <div key={move.id} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center font-carved text-torch">
              {i < MAX_FIGHT_MOVES ? i + 1 : '—'}
            </span>
            <input
              disabled={!editable}
              defaultValue={move.slug}
              onBlur={(e) => {
                const slug = slugify(e.target.value)
                if (slug !== move.slug) void editFightMove(move.id, { slug })
              }}
              className={`${field} max-w-[7rem]`}
            />
            <span className="shrink-0 text-xs text-mortar">beats</span>
            <input
              disabled={!editable}
              defaultValue={move.beats ?? ''}
              placeholder="Rising Tiger"
              onBlur={(e) =>
                e.target.value !== (move.beats ?? '') &&
                void editFightMove(move.id, { beats: e.target.value || null })
              }
              className={field}
            />
            <button
              disabled={!editable}
              onClick={() => void removeFightMove(move.id)}
              title="Remove move"
              className="px-2 text-grave disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          disabled={!editable}
          onClick={() => void addFightMove(fight.id, `MOVE_${moves.length + 1}`)}
          className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
        >
          + Add move
        </button>
      </div>

      {/* Rounds. */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-mortar">Rounds — in order</span>
        {rounds.map((round, i) => {
          const answer = counterFor(moves, round)
          const digit = answer ? moves.findIndex((m) => m.id === answer.id) + 1 : null
          return (
            <div key={round.id} className="rounded border border-mortar/40 p-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="w-5 shrink-0 text-center font-carved text-mortar">{i + 1}</span>
                <input
                  disabled={!editable}
                  defaultValue={round.opponent_move}
                  placeholder="Rising Tiger"
                  onBlur={(e) =>
                    e.target.value !== round.opponent_move &&
                    void editFightRound(round.id, { opponent_move: e.target.value })
                  }
                  className={field}
                />
                <span
                  className={`shrink-0 text-xs ${answer && digit && digit <= MAX_FIGHT_MOVES ? 'text-torch' : 'text-grave'}`}
                >
                  {answer && digit && digit <= MAX_FIGHT_MOVES
                    ? `press ${digit}`
                    : 'no answer'}
                </span>
                <button
                  disabled={!editable}
                  onClick={() => void removeFightRound(round.id)}
                  title="Remove round"
                  className="px-2 text-grave disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
              <textarea
                disabled={!editable}
                rows={2}
                defaultValue={round.narration}
                placeholder="What the caller hears this round."
                onBlur={(e) =>
                  e.target.value !== round.narration &&
                  void editFightRound(round.id, { narration: e.target.value })
                }
                className={field}
              />
            </div>
          )
        })}
        <button
          disabled={!editable}
          onClick={() => void addFightRound(fight.id)}
          className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
        >
          + Add round
        </button>
      </div>

      {/* Where the fight lets out. */}
      {(
        [
          ['win_node_id', 'After winning'],
          ['lose_node_id', 'After losing'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs text-mortar">{label}</span>
          <select
            disabled={!editable}
            className={field}
            value={fight[key] ?? ''}
            onChange={(e) => void editFight(fight.id, { [key]: e.target.value || null })}
          >
            <option value="">— nowhere yet —</option>
            {rooms.map((n) => (
              <option key={n.id} value={n.id}>
                {n.slug}
              </option>
            ))}
          </select>
        </label>
      ))}

      {view.problems.length > 0 && (
        <ul className="rounded border border-grave/40 bg-grave/10 p-3 text-xs">
          {view.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <button
        disabled={!editable}
        onClick={() => {
          if (window.confirm('Remove the fight? The room and its narration stay; the moves and rounds go.')) {
            void removeFight(fight.id)
          }
        }}
        className="self-start text-xs text-grave underline disabled:opacity-40"
      >
        Remove the fight
      </button>
    </div>
  )
}
