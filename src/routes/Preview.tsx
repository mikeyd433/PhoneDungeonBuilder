import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView } from '@/features/room/roomModel'
import DungeonRoom from '@/features/room/vector/DungeonRoom'
import { makeGraph } from '@/test/factory'
import type { RoomView } from '@/features/room/roomModel'

/**
 * A visual bench for the room art.
 *
 * Every state a room can be in, side by side, with no database and no auth. The
 * dressing is the part of this app that can't be verified by a unit test — this
 * is how you check that a portal still reads as a stairwell after an edit, and
 * that a dark room really is darker than a lit one.
 *
 * Unlinked from the app's navigation; reachable at /preview.
 */

function sample(name: string, build: () => RoomView | null) {
  return { name, view: build() }
}

function roomFrom(
  slugs: string[],
  edges: string[],
  opts: Parameters<typeof makeGraph>[2],
  at: string,
): RoomView | null {
  const g = makeGraph(slugs, edges, opts)
  const node = [...g.nodes.values()].find((n) => n.slug === at)
  if (!node) return null
  g.nodes.set(node.id, {
    ...node,
    title: at,
    narration: 'The hull groans. Something big is circling below.',
  })
  return buildRoomView(g, deriveGraph(g), node.id)
}

export default function Preview() {
  const samples = [
    sample('Dark — no audio yet', () => roomFrom(['A', 'B'], ['A>B'], {}, 'A')),
    sample('Lit — audio recorded', () => roomFrom(['A', 'B'], ['A>B'], { recorded: ['A'] }, 'A')),
    sample('Three exits, one bricked', () =>
      roomFrom(['A', 'B', 'C'], ['A>B', 'A>C', 'A>'], { recorded: ['A'] }, 'A'),
    ),
    sample('Portal — a back-edge, drawn as a stairwell', () =>
      roomFrom(['A', 'B', 'C'], ['A>B', 'B>C', 'C>A'], { recorded: ['C'] }, 'C'),
    ),
    sample('Ending — rubble and a skull', () =>
      roomFrom(['A', 'FIN'], ['A>FIN'], { endings: ['FIN'], recorded: ['FIN'] }, 'FIN'),
    ),
    sample('Deep room — depth notches', () =>
      roomFrom(
        ['A', 'B', 'C', 'D', 'E', 'F'],
        ['A>B', 'B>C', 'C>D', 'D>E', 'E>F'],
        { recorded: ['F'] },
        'F',
      ),
    ),
  ]

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-xl text-torch">Room states</h1>
      <div className="grid gap-8 sm:grid-cols-2">
        {samples.map(({ name, view }) => (
          <figure key={name} className="rounded border border-mortar/40 bg-stone/40 p-3">
            <figcaption className="mb-2 font-paper text-sm text-mortar">{name}</figcaption>
            {view ? (
              <DungeonRoom view={view} flare={false} onExit={() => {}} />
            ) : (
              <p className="text-grave">could not build</p>
            )}
          </figure>
        ))}
      </div>
    </main>
  )
}
