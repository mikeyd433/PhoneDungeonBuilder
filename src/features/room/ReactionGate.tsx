import { useDelve } from '@/features/graph/store'
import { reactionPlaybackFor } from '@/features/cast/dialogue'
import { publicAudioUrl } from '@/features/audio/storage'

/**
 * The doorway, held open for a moment.
 *
 * A door with a reaction is the one place where walking through skips past
 * something the caller would hear. Everywhere else the room view shows you
 * what is there; here the writing lives between two rooms, so leaving without
 * a pause meant the only way to check it was to remember it existed and go
 * looking. Stopping to play it is the point.
 *
 * Only doors that have one stop you — an ordinary door still walks straight
 * through, because a confirm on every step would be intolerable.
 */
export default function ReactionGate({
  choiceId,
  onContinue,
  onCancel,
}: {
  choiceId: string
  onContinue: () => void
  onCancel: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const choice = graph?.choices.get(choiceId)
  if (!graph || !choice) return null

  const parts = reactionPlaybackFor(graph, choice.id)
  const to = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null
  const missing = parts.filter((p) => !p.audioPath).length

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-depth/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="What is heard on the way through"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-mortar bg-depth p-4"
      >
        <h3 className="text-sm text-torch">
          Pressing {choice.digit}
          {choice.label ? ` — ${choice.label}` : ''}
        </h3>
        <p className="mt-1 text-xs text-cold">
          Heard on the way through, before {to ? (to.title || to.slug) : 'the next room'}.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          {parts.map((part) => (
            <div key={part.id} className="flex flex-col gap-1">
              <p className="text-sm">
                {part.speaker && (
                  <span className="mr-2 font-carved text-xs uppercase tracking-[0.12em] text-torch">
                    {part.speaker}
                  </span>
                )}
                <span className={part.speaker ? 'font-voice' : 'text-parchment'}>
                  {part.say || <span className="text-cold">nothing written</span>}
                </span>
              </p>
              {part.audioPath ? (
                <audio controls preload="none" src={publicAudioUrl(part.audioPath)} className="h-8 w-full" />
              ) : (
                <span className="text-xs text-grave">
                  No take — silence on the phone at this point.
                </span>
              )}
            </div>
          ))}
        </div>

        {missing > 0 && parts.length > 1 && (
          <p className="mt-3 text-xs text-grave">
            {missing} of {parts.length} parts still need recording.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onContinue}
            autoFocus
            className="flex-1 rounded border border-torch px-3 py-2 text-sm text-torch"
          >
            Go through to {to ? (to.title || to.slug) : 'the next room'}
          </button>
          <button
            onClick={onCancel}
            className="rounded border border-mortar/60 px-3 py-2 text-sm text-mortar"
          >
            Stay here
          </button>
        </div>
      </div>
    </div>
  )
}
