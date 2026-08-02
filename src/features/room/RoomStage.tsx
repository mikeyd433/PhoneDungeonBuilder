import type { ExitView, RoomView } from './roomModel'

/**
 * The room renderer seam.
 *
 * Everything visual about a room goes through this props contract. Swapping the
 * flat-vector implementation for a sprite pack means writing another component
 * with this same signature and changing one import — no logic moves, because the
 * component receives a fully-derived RoomView and never touches the graph.
 *
 * Phase 1 renders this plainly and legibly; Phase 2 dresses it as carved stone.
 */
export interface RoomStageProps {
  view: RoomView
  onEnter: (exit: ExitView) => void
  onChisel: (exit: ExitView) => void
  onRetreat: () => void
}

const exitGlyph: Record<ExitView['kind'], string> = {
  door: '▯',
  portal: '⟳',
  bricked: '▨',
}

const exitHint: Record<ExitView['kind'], string> = {
  door: 'archway',
  portal: 'stairwell — leads back up',
  bricked: 'bricked over — tap to chisel',
}

export default function RoomStage({ view, onEnter, onChisel, onRetreat }: RoomStageProps) {
  const { node } = view

  return (
    <div
      className={[
        'flex min-h-0 flex-1 flex-col gap-4 p-4 transition-colors duration-500',
        view.torchLit ? 'bg-stone-lit' : 'bg-stone',
      ].join(' ')}
    >
      {/* Wall exits. §11.1: three fits the walls and good IVR practice. */}
      {view.isEnding ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-carved uppercase tracking-[0.12em] text-grave">
            ☠ Rubble. The way ends here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {view.exits.map((exit) => (
            <button
              key={exit.digit}
              onClick={() => (exit.kind === 'bricked' ? onChisel(exit) : onEnter(exit))}
              title={exitHint[exit.kind]}
              className={[
                'flex flex-col items-center gap-1 rounded border p-3 text-center',
                exit.kind === 'bricked'
                  ? 'border-cold/60 text-cold'
                  : 'border-mortar text-parchment hover:border-torch',
              ].join(' ')}
            >
              <span className="font-carved text-lg">{exit.digit}</span>
              <span aria-hidden className="text-2xl leading-none">
                {exitGlyph[exit.kind]}
              </span>
              <span className="text-xs opacity-80">
                {exit.label || (exit.kind === 'bricked' ? 'unwritten' : '—')}
              </span>
              {/* F1.7 / F1.8 — chest, floor-hole and portcullis sit at the door
                  they belong to, not floating in the room. */}
              <span className="flex gap-1 text-xs">
                {exit.grants.length > 0 && <span title={exit.grants.join(', ')}>🎁</span>}
                {exit.revokes.length > 0 && <span title={exit.revokes.join(', ')}>🕳</span>}
                {exit.gate && (
                  <span title={`${exit.gate.behavior} — ${exit.gate.conditionCount} condition(s)`}>
                    {'🛡'}
                    {exit.gate.conditionCount > 1 && (
                      <sub className="text-[10px]">{exit.gate.conditionCount}</sub>
                    )}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* F1.13 — beyond three, exits stack rather than crowd the walls. */}
      {view.overflowExits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {view.overflowExits.map((exit) => (
            <li key={exit.digit}>
              <button
                onClick={() => (exit.kind === 'bricked' ? onChisel(exit) : onEnter(exit))}
                className="flex w-full items-center gap-3 rounded border border-mortar/50 px-3 py-2 text-left text-sm hover:border-torch"
              >
                <span className="font-carved">{exit.digit}</span>
                <span>{exit.label || 'unwritten'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Back wall: the room's own name, carved. */}
      <h2 className="mt-2 text-center text-xl text-torch">{node.title || node.slug}</h2>

      {/* Floor plaque. */}
      <p className="rounded border border-mortar/40 bg-depth/40 p-4 text-lg leading-relaxed">
        {node.narration || <span className="text-cold">Nothing written here yet.</span>}
      </p>

      {/* Arrival effects sit centre-floor: the node granted them, not a door. */}
      {(view.arrivalGrants.length > 0 || view.arrivalRevokes.length > 0) && (
        <p className="text-center text-sm">
          {view.arrivalGrants.map((s) => (
            <span key={s} className="mr-2">
              🎁 {s}
            </span>
          ))}
          {view.arrivalRevokes.map((s) => (
            <span key={s} className="mr-2 text-grave">
              🕳 {s}
            </span>
          ))}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-mortar">
        <button onClick={onRetreat} disabled={view.retreats.length === 0} className="underline disabled:opacity-40">
          ◄ Retreat
        </button>
        <span>
          {/* F1.10 — depth notches. */}
          {view.depth !== null ? '▏'.repeat(Math.min(view.depth, 12)) : ''}
          {view.depth !== null ? ` depth ${view.depth}` : 'unreachable'}
        </span>
      </div>
    </div>
  )
}
