import { useDelve } from '@/features/graph/store'
import { slugify } from '@/lib/slug'
import { canWrite } from '@/types/domain'
import { buildFightView, MAX_FIGHT_MOVES, outcomeKey, resolveMove } from './model'

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
  const setFightOutcome = useDelve((s) => s.setFightOutcome)

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
          each round announces something and the caller presses a digit. Every move can go
          somewhere different, or they can all go to the same place — and by default the move that
          counters the announcement carries on while everything else takes the losing route.
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
        {rounds.map((round, i) => (
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

            {/* Where each digit goes. Left on "default" the counter rule
                decides, which is what keeps a plain fight a two-column table
                instead of a grid you have to fill in. */}
            <div className="mt-2 flex flex-col gap-1">
              {moves.slice(0, MAX_FIGHT_MOVES).map((move, m) => {
                const named = view.outcomes.get(outcomeKey(round.id, move.id))
                const resolved = resolveMove(view, i, move.id)
                return (
                  <div key={move.id} className="flex items-center gap-2 text-xs">
                    <span className="w-5 shrink-0 text-center font-carved text-torch">{m + 1}</span>
                    <span className="w-20 shrink-0 truncate text-mortar">{move.slug}</span>
                    <select
                      disabled={!editable}
                      value={named ? (named.to_node_id ?? '__unwired__') : '__default__'}
                      onChange={(e) => {
                        const v = e.target.value
                        void setFightOutcome(
                          round.id,
                          move.id,
                          v === '__default__' ? undefined : v === '__unwired__' ? null : v,
                        )
                      }}
                      className="min-w-0 flex-1 rounded border border-mortar/60 bg-stone px-2 py-1"
                    >
                      <option value="__default__">
                        default —{' '}
                        {resolved.via === 'advance'
                          ? `next round (${(resolved.nextRound ?? 0) + 1})`
                          : resolved.via === 'win'
                            ? `win: ${view.winTitle ?? 'nowhere yet'}`
                            : `lose: ${view.loseTitle ?? 'nowhere yet'}`}
                      </option>
                      <option value="__unwired__">— written, nowhere yet —</option>
                      {rooms.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.slug}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}

              {moves.length > 0 && (
                <select
                  disabled={!editable}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    for (const move of moves.slice(0, MAX_FIGHT_MOVES)) {
                      void setFightOutcome(round.id, move.id, v === '__default__' ? undefined : v)
                    }
                    e.target.value = ''
                  }}
                  className="self-start rounded border border-mortar/60 bg-stone px-2 py-1 text-xs text-mortar"
                >
                  <option value="">every move leads to…</option>
                  <option value="__default__">— back to the defaults —</option>
                  {rooms.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.slug}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
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
          ['win_node_id', 'After winning', 'Where a countering move goes on the last round.'],
          [
            'lose_node_id',
            'After losing',
            'Where a non-countering move goes — and where an unmapped digit or silence always goes.',
          ],
        ] as const
      ).map(([key, label, help]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs text-mortar">{label}</span>
          <span className="text-xs text-cold">{help}</span>
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
