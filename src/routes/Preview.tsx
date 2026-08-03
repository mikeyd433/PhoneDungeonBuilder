import { useEffect, useMemo, useState } from 'react'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView } from '@/features/room/roomModel'
import DungeonRoom from '@/features/room/vector/DungeonRoom'
import { addFight, makeGraph } from '@/test/factory'
import type { RoomView } from '@/features/room/roomModel'
import Automap from '@/features/automap/Automap'
import { layoutAutomap, type MapLayout } from '@/features/automap/layout'
import { MAX_WALL_ARCHES } from '@/features/room/vector/geometry'
import { ROOM_DESIGNS } from '@/features/room/vector/designs'

/**
 * The art bench, as something you can actually look at one thing in.
 *
 * The dressing is the part of this app no unit test can check — whether a
 * portal still reads as a stairwell, whether a dark room is really darker, and
 * now whether a one-door wall reads as a room rather than as a three-door wall
 * with two missing. That needs the piece large and on its own, not eighteen
 * thumbnails in a scroll.
 *
 * So: a nav down the side, one thing at a time, big. No database and no auth —
 * every sample is built in memory from the same factory the tests use, which is
 * what keeps the bench honest about what the app actually renders.
 */

interface Piece {
  id: string
  name: string
  note: string
  build: () => RoomView | null
}

function roomFrom(
  slugs: string[],
  edges: string[],
  opts: Parameters<typeof makeGraph>[2],
  at: string,
  patch: Partial<Parameters<typeof makeGraph>[2]> & { design?: string; narration?: string } = {},
): RoomView | null {
  const g = makeGraph(slugs, edges, opts)
  const node = [...g.nodes.values()].find((n) => n.slug === at)
  if (!node) return null
  g.nodes.set(node.id, {
    ...node,
    title: at,
    narration: patch.narration ?? 'The hull groans. Something big is circling below.',
    ...(patch.design ? { room_design: patch.design } : {}),
  })
  return buildRoomView(g, deriveGraph(g), node.id)
}

/** A room with exactly `n` wired doors, so each wall layout can be compared. */
function wallOf(n: number): RoomView | null {
  const rooms = ['HERE', ...Array.from({ length: n }, (_, i) => `R${i + 1}`)]
  const edges = Array.from({ length: n }, (_, i) => `HERE>R${i + 1}`)
  return roomFrom(rooms, edges, { recorded: ['HERE'] }, 'HERE', {
    narration: n === 0 ? 'Nothing leads anywhere yet.' : `${n} way${n === 1 ? '' : 's'} onward.`,
  })
}

const STATES: Piece[] = [
  {
    id: 'dark',
    name: 'Dark — no take yet',
    note: 'Unrecorded territory is literally unlit. This is most of a new story.',
    build: () => roomFrom(['A', 'B'], ['A>B'], {}, 'A'),
  },
  {
    id: 'lit',
    name: 'Lit — recorded',
    note: 'The torch is the reward for finishing a room, and the wash spills from it.',
    build: () => roomFrom(['A', 'B'], ['A>B'], { recorded: ['A'] }, 'A'),
  },
  {
    id: 'bricked',
    name: 'An unwritten branch',
    note: 'A door the caller can press that goes nowhere yet — bricked, and it keeps its label.',
    build: () => roomFrom(['A', 'B', 'C'], ['A>B', 'A>C', 'A>'], { recorded: ['A'] }, 'A'),
  },
  {
    id: 'portal',
    name: 'Portal — a back-edge',
    note: 'Drawn as a stairwell so reconvergence never reads as branching (F1.6).',
    build: () => roomFrom(['A', 'B', 'C'], ['A>B', 'B>C', 'C>A'], { recorded: ['C'] }, 'C'),
  },
  {
    id: 'death',
    name: 'Ending — a death',
    note: 'Rubble and a skull. The way ends here, and badly.',
    build: () => roomFrom(['A', 'FIN'], ['A>FIN'], { endings: ['FIN'], recorded: ['FIN'] }, 'FIN'),
  },
  {
    id: 'win',
    name: 'Ending — a win',
    note: 'The wall opens into daylight: the only light in this dungeon that is not the torch.',
    build: () =>
      roomFrom(
        ['A', 'FIN'],
        ['A>FIN'],
        { endings: ['FIN'], wins: ['FIN'], recorded: ['FIN'] },
        'FIN',
        { narration: 'You make it out. You do not look back.' },
      ),
  },
  {
    id: 'fight',
    name: 'Fight — the arena',
    note: 'The walls give way. The way onward is won, not chosen, so there are no archways.',
    build: () => {
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
    },
  },
  {
    id: 'broken-fight',
    name: 'Fight — unwinnable',
    note: 'A round nothing counters kills every caller who reaches it, and it reads broken.',
    build: () => {
      const g = makeGraph(['A', 'SHARKS'], ['A>SHARKS'], { recorded: ['SHARKS'] })
      addFight(g, 'SHARKS', { moves: ['PUNCH beats Kick'], rounds: ['Headbutt'] })
      const node = [...g.nodes.values()].find((n) => n.slug === 'SHARKS')!
      return buildRoomView(g, deriveGraph(g), node.id)
    },
  },
  {
    id: 'deep',
    name: 'Deep — depth notches',
    note: 'How far in you are, cut into the left wall (F1.10).',
    build: () =>
      roomFrom(['A', 'B', 'C', 'D', 'E', 'F'], ['A>B', 'B>C', 'C>D', 'D>E', 'E>F'], {
        recorded: ['F'],
      }, 'F'),
  },
]

/**
 * One door is not three doors with two missing.
 *
 * Every wall here has one blank arch to chisel through on top of its real
 * doors, which is why the counts run one ahead of the number of ways onward.
 */
const WALLS: Piece[] = Array.from({ length: MAX_WALL_ARCHES }, (_, i) => {
  const doors = i + 1
  return {
    id: `wall-${doors}`,
    name: `${doors} archway${doors === 1 ? '' : 's'}`,
    note:
      doors === 1
        ? 'A room nobody has cut a way out of yet: one blank arch, and it fills the wall.'
        : `${doors - 1} way${doors === 2 ? '' : 's'} onward plus somewhere to dig. Fewer doors, bigger arches.`,
    build: () => wallOf(doors - 1),
  }
})

const DESIGNS: Piece[] = ROOM_DESIGNS.map((design) => ({
  id: `design-${design.id}`,
  name: design.name,
  note: design.blurb,
  build: () =>
    roomFrom(['A', 'B', 'C'], ['A>B', 'A>C'], { recorded: ['A'] }, 'A', {
      design: design.id,
      narration: design.blurb,
    }),
}))

const SECTIONS = [
  { id: 'states', label: 'Room states', pieces: STATES },
  { id: 'walls', label: 'Door layouts', pieces: WALLS },
  { id: 'designs', label: 'Designs', pieces: DESIGNS },
] as const

/** A small dungeon with every automap feature in it. */
function AutomapSample() {
  const [layout, setLayout] = useState<MapLayout | null>(null)
  useEffect(() => {
    const g = makeGraph(
      ['ENTRANCE', 'HULL', 'DECK', 'HOLD', 'SHARKS_1', 'FIN', 'DROWNED', 'LOST'],
      [
        'ENTRANCE>HULL',
        'ENTRANCE>DECK',
        'HULL>HOLD',
        'DECK>HOLD',
        'HOLD>SHARKS_1',
        'SHARKS_1>ENTRANCE',
        'SHARKS_1>FIN',
        'SHARKS_1>DROWNED',
        'HOLD>',
      ],
      { endings: ['FIN', 'DROWNED'], wins: ['FIN'], recorded: ['ENTRANCE', 'HULL'] },
    )
    for (const n of g.nodes.values()) {
      if (['ENTRANCE', 'HULL', 'HOLD', 'FIN'].includes(n.slug)) {
        g.nodes.set(n.id, { ...n, narration: 'Something is written here.' })
      }
    }
    void layoutAutomap(g, deriveGraph(g)).then(setLayout)
  }, [])

  if (!layout) return <p className="font-paper text-mortar">surveying…</p>
  return (
    <div className="h-[60vh] overflow-hidden rounded border border-mortar/40">
      <Automap layout={layout} currentId={layout.rooms[3]?.id ?? null} onTeleport={() => {}} />
    </div>
  )
}

export default function Preview() {
  const [at, setAt] = useState<string>(STATES[0].id)

  const piece = useMemo(
    () => SECTIONS.flatMap((s) => s.pieces).find((p) => p.id === at) ?? null,
    [at],
  )
  const view = useMemo(() => piece?.build() ?? null, [piece])

  return (
    <main className="flex min-h-[100dvh] flex-col sm:flex-row">
      {/* The nav. Sticky on a wide screen, an ordinary scroll on a narrow one —
          this is a bench, and a bench does not need a drawer. */}
      <nav className="shrink-0 border-b border-mortar/40 sm:h-[100dvh] sm:w-56 sm:overflow-y-auto sm:border-b-0 sm:border-r">
        <h1 className="px-3 py-3 font-carved text-sm uppercase tracking-[0.12em] text-torch">
          Art bench
        </h1>
        <div className="flex gap-1 overflow-x-auto px-2 pb-2 sm:flex-col sm:overflow-visible">
          {SECTIONS.map((section) => (
            <div key={section.id} className="shrink-0 sm:mb-3">
              <span className="block px-1 py-1 text-xs uppercase tracking-wider text-mortar">
                {section.label}
              </span>
              <div className="flex gap-1 sm:flex-col">
                {section.pieces.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setAt(p.id)}
                    className={[
                      'whitespace-nowrap rounded px-2 py-1.5 text-left text-xs sm:whitespace-normal',
                      at === p.id ? 'bg-torch/15 text-torch' : 'text-mortar hover:text-parchment',
                    ].join(' ')}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            onClick={() => setAt('automap')}
            className={[
              'shrink-0 whitespace-nowrap rounded px-2 py-1.5 text-left text-xs sm:whitespace-normal',
              at === 'automap' ? 'bg-torch/15 text-torch' : 'text-mortar hover:text-parchment',
            ].join(' ')}
          >
            Automap
          </button>
        </div>
      </nav>

      <section className="min-w-0 flex-1 p-4 sm:p-6">
        {at === 'automap' ? (
          <>
            <h2 className="font-carved text-lg uppercase tracking-[0.12em] text-torch">Automap</h2>
            <p className="mb-4 max-w-prose text-sm text-cold">
              Branches, a reconvergence, a back-edge, both kinds of ending, an unwritten branch and
              an orphan.
            </p>
            <AutomapSample />
          </>
        ) : piece ? (
          <>
            <h2 className="font-carved text-lg uppercase tracking-[0.12em] text-torch">
              {piece.name}
            </h2>
            <p className="mb-4 max-w-prose text-sm text-cold">{piece.note}</p>
            {view ? (
              <div className="mx-auto max-w-2xl rounded border border-mortar/40 bg-stone/40 p-3">
                <DungeonRoom view={view} flare={false} onExit={() => {}} peek />
              </div>
            ) : (
              <p className="text-grave">could not build</p>
            )}
          </>
        ) : null}
      </section>
    </main>
  )
}
