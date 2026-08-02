import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import TakeRecorder from '@/features/audio/TakeRecorder'
import DialogueSection from '@/features/cast/DialogueSection'
import { splitsByLine } from '@/features/cast/dialogue'
import { estimateSeconds } from '@/lib/speech'
import { canWrite } from '@/types/domain'

/**
 * What the caller hears between pressing a digit and arriving.
 *
 * Its own sheet rather than another field in the exits row, because it is
 * writing: a couple of sentences and a take, which is the same shape as a room
 * and deserves the same room to work in. The exits row stays a row.
 */
export default function ReactionSheet({
  choiceId,
  onClose,
}: {
  choiceId: string
  onClose: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const updateChoice = useDelve((s) => s.updateChoice)
  const choice = graph?.choices.get(choiceId)
  const [draft, setDraft] = useState<string | null>(null)

  if (!graph || !choice) return null
  const editable = canWrite(role)
  const from = graph.nodes.get(choice.from_node_id)
  const to = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null
  const text = draft ?? choice.reaction_narration ?? ''
  const splitAudio = splitsByLine(graph, { choiceId: choice.id })

  const commit = () => {
    if (draft === null || draft === (choice.reaction_narration ?? '')) return
    void updateChoice(choice.id, { reaction_narration: draft })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-depth/80" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            Pressing {choice.digit}
            {choice.label ? ` — ${choice.label}` : ''}
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Done
          </button>
        </div>

        <p className="mb-3 text-xs text-cold">
          Played after the keypress and before {to ? (to.title || to.slug) : 'the next room'}. It
          belongs to neither room either side: put it in the one you left and every other door
          hears it too, put it in the one you arrive at and it plays again when you come back
          another way.
        </p>

        <label className="mb-3 flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs uppercase tracking-wider text-mortar">
            <span>What is heard</span>
            <span className="text-mortar">~{estimateSeconds(text)}s</span>
          </span>
          <textarea
            rows={4}
            disabled={!editable}
            placeholder="The glass goes everywhere."
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="w-full rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60"
          />
        </label>

        {/* The take. Named for the door so the bucket stays legible, and the
            same name the audio manifest asks an actor for. Hidden once the
            reaction plays line by line: the file on the door is not what is
            heard then, and offering it would invite a take nothing plays. */}
        {!splitAudio && (
          <TakeRecorder
            name={`${from?.slug ?? 'room'}__d${choice.digit}__react`}
            path={choice.audio_path}
            durationMs={choice.audio_duration_ms}
            onSaved={(path, ms) =>
              updateChoice(choice.id, { audio_path: path, audio_duration_ms: ms })
            }
          />
        )}

        {text.trim() && !splitAudio && !choice.audio_path && (
          <p className="mt-3 text-xs text-grave">
            Written but not recorded — the caller hears nothing here until somebody reads it.
          </p>
        )}

        {/* Two people can argue in a doorway. Same split, same cast dropdowns
            and same per-line takes as a room, because it is the same writing. */}
        <div className="mt-4 border-t border-mortar/40 pt-4">
          <DialogueSection owner={{ choiceId: choice.id }} what="reaction" />
        </div>
      </div>
    </div>
  )
}
