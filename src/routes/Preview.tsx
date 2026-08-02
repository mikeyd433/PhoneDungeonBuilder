import { useEffect, useState } from 'react'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView } from '@/features/room/roomModel'
import DungeonRoom from '@/features/room/vector/DungeonRoom'
import { addFight, makeGraph } from '@/test/factory'
import type { RoomView } from '@/features/room/roomModel'
import Automap from '@/features/automap/Automap'
import { layoutAutomap, type MapLayout } from '@/features/automap/layout'
import { ROOM_DESIGNS } from '@/features/room/vector/designs'

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

/** A small dungeon with every automap feature in it: branches, a reconvergence,
 *  a back-edge, an ending, an unwritten branch and an orphan. */
function AutomapSample() {
  const [layout, setLayout] = useState<MapLayout | null>(null)
  useEffect(() => {
    const g = makeGraph(
      ['ENTRANCE', 'HULL', 'DECK', 'HOLD', 'SHARKS_1', 'FIN', 'LOST'],
      ['ENTRANCE>HULL', 'ENTRANCE>DECK', 'HULL>HOLD', 'DECK>HOLD', 'HOLD>SHARKS_1',
       'SHARKS_1>ENTRANCE', 'SHARKS_1>FIN', 'HOLD>'],
      { endings: ['FIN'], recorded: ['ENTRANCE', 'HULL'] },
    )
    // Give a couple of rooms narration so "written" vs "stub" is visible.
    for (const n of g.nodes.values()) {
      if (['ENTRANCE', 'HULL', 'HOLD', 'FIN'].includes(n.slug)) {
        g.nodes.set(n.id, { ...n, narration: 'Something is written here.' })
      }
    }
    void layoutAutomap(g, deriveGraph(g)).then(setLayout)
  }, [])

  if (!layout) return <p className="font-paper text-mortar">surveying…</p>
  return (
    <div className="h-[520px] overflow-hidden rounded border border-grid">
      <Automap layout={layout} currentId={layout.rooms[3]?.id ?? null} onTeleport={() => {}} />
    </div>
  )
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
    sample('Fight — the walls give way to the arena', () => {
      const g = makeGraph(['A', 'SHARKS', 'SHORE', 'DROWNED'], ['A>SHARKS'], {
        recorded: ['SHARKS'],
        endings: ['DROWNED'],
      })
      addFight(g, 'SHARKS', {
        moves: ['PUNCH beats Kick', 'KICK beats Block', 'BLOCK beats Punch'],
        rounds: ['Kick', 'Block', 'Punch'],
        win: 'SHORE',
        lose: 'DROWNED',
      })
      const node = [...g.nodes.values()].find((n) => n.slug === 'SHARKS')!
      g.nodes.set(node.id, { ...node, title: 'Circled', narration: 'Something big is below.' })
      return buildRoomView(g, deriveGraph(g), node.id)
    }),
    sample('Fight — unwinnable, so it reads broken', () => {
      const g = makeGraph(['A', 'SHARKS'], ['A>SHARKS'], { recorded: ['SHARKS'] })
      addFight(g, 'SHARKS', { moves: ['PUNCH beats Kick'], rounds: ['Headbutt'] })
      const node = [...g.nodes.values()].find((n) => n.slug === 'SHARKS')!
      return buildRoomView(g, deriveGraph(g), node.id)
    }),
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

      <h2 className="mb-1 mt-10 text-xl text-torch">Room designs</h2>
      <p className="mb-4 text-sm text-mortar">
        Ten places a room can be. All lit, so the treatments are comparable.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        {ROOM_DESIGNS.map((design) => {
          const g = makeGraph(['A', 'B', 'C'], ['A>B', 'A>C'], { recorded: ['A'] })
          const first = [...g.nodes.values()][0]
          g.nodes.set(first.id, {
            ...first,
            title: design.name,
            narration: design.blurb,
            room_design: design.id,
          })
          const v = buildRoomView(g, deriveGraph(g), first.id)
          return (
            <figure key={design.id} className="rounded border border-mortar/40 bg-stone/40 p-3">
              <figcaption className="mb-2">
                <span className="font-carved text-sm uppercase tracking-[0.12em] text-torch">
                  {design.name}
                </span>
                <span className="block font-paper text-xs text-mortar">{design.blurb}</span>
              </figcaption>
              {v && <DungeonRoom view={v} flare={false} onExit={() => {}} />}
            </figure>
          )
        })}
      </div>

      <h2 className="mb-4 mt-10 text-xl text-torch">Automap</h2>
      <AutomapSample />
    </main>
  )
}
