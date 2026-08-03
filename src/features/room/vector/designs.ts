/**
 * Room designs — ten places a room can be.
 *
 * A dungeon rendered in one texture for a hundred and forty rooms reads as one
 * room visited a hundred and forty times. A design says what KIND of place this
 * is, so walking from the lagoon into the inside of a tree feels like going
 * somewhere.
 *
 * A design changes ONLY the surface. Spec §0's first rule is that every visual
 * element encodes real data, so the torch, the archways, the carved digits, the
 * chests, the portcullis and the depth notches are identical in all ten — they
 * mean what they mean regardless of what the walls are made of. If a design ever
 * needs to move or hide one of those, it is no longer a design.
 *
 * The palette stays inside §3's tokens. These are warm dark stone lit by fire;
 * a design shifts the hue, it does not introduce a new colour language.
 */

export type WallTexture =
  | 'courses' // dressed stone blocks
  | 'strata' // natural rock layers
  | 'planks' // horizontal timber
  | 'bark' // vertical living wood
  | 'bone' // stacked long bones
  | 'tiles' // small glazed tiles
  | 'ribs' // structural ribs, like a hull or a ribcage
  | 'flowstone' // sheeted mineral curtains — wet limestone
  | 'facets' // angular crystal faces
  | 'timbers' // mine framing: uprights under a header
  | 'brick' // small hard brick, the arch of a tunnel
  | 'frost' // ice, cracked in long shards
  | 'none'

export type FloorMotif =
  | 'none'
  | 'water'
  | 'rubble'
  | 'grate'
  | 'sand'
  | 'chasm' // a gap across the floor, and nothing under it
  | 'rails' // a mine cart track running away from you
  | 'channel' // a sewer's centre gutter
  | 'pool' // a still, reflective plane

/** An extra mark on the back wall, where a texture alone doesn't say enough. */
export type WallMotif =
  | 'none'
  | 'receding'
  | 'stalactites' // teeth from the ceiling — the thing that says "cave"
  | 'shelves' // horizontal runs, packed
  | 'squeeze' // the walls close in: the opening is smaller than the room

export interface RoomDesign {
  id: string
  name: string
  /** One line, shown in the picker. Says what the place is, not what it looks like. */
  blurb: string
  /** Back and left wall — the lit faces. */
  wall: { lit: string; dim: string }
  /** Right wall and ceiling — the faces turned away from the torch. */
  wallShaded: { lit: string; dim: string }
  floor: { lit: string; dim: string }
  /** Carved joins and outlines. */
  edge: { lit: string; dim: string }
  /** The torch's wash. Warm by default; cold where the place is meant to feel wrong. */
  glow: { inner: string; outer: string }
  texture: WallTexture
  floorMotif: FloorMotif
  wallMotif?: WallMotif
  /** No ceiling polygon — the room opens upward into dark. */
  openCeiling?: boolean
  /** No walls at all: only the floor and the doors, adrift in the dark. */
  openWalls?: boolean
}

/**
 * Ordered roughly by how far from ordinary stone they are, so the picker reads
 * as a gradient rather than a grab bag. The caves sit together near the top —
 * "a cave" is not one place, and a story that spends twenty rooms underground
 * needs the dripping one to look nothing like the crystal one or the crawl.
 */
export const ROOM_DESIGNS: RoomDesign[] = [
  {
    id: 'stone',
    name: 'Dressed stone',
    blurb: 'Cut blocks and mortar. The default dungeon corridor.',
    wall: { lit: '#4A3D30', dim: '#2B241E' },
    wallShaded: { lit: '#3C3227', dim: '#241E19' },
    floor: { lit: '#3A2F25', dim: '#221C17' },
    edge: { lit: '#6B5A47', dim: '#3A3129' },
    glow: { inner: '#E8A33D', outer: '#B85C1E' },
    texture: 'courses',
    floorMotif: 'none',
  },
  {
    id: 'cavern',
    name: 'Raw cavern',
    blurb: 'Natural rock, layered and uneven. Nobody built this.',
    wall: { lit: '#4B4038', dim: '#2A2420' },
    wallShaded: { lit: '#3B322C', dim: '#221D1A' },
    floor: { lit: '#33291F', dim: '#1E1813' },
    edge: { lit: '#7A6552', dim: '#3E342C' },
    glow: { inner: '#E8A33D', outer: '#B85C1E' },
    texture: 'strata',
    floorMotif: 'rubble',
  },
  {
    id: 'dripstone',
    name: 'Dripstone cave',
    blurb: 'Wet limestone, curtained and toothed. Everything here is still growing.',
    wall: { lit: '#4A4238', dim: '#2A2521' },
    wallShaded: { lit: '#3A342C', dim: '#221E1A' },
    floor: { lit: '#332B22', dim: '#1E1915' },
    edge: { lit: '#8A7A62', dim: '#43392E' },
    glow: { inner: '#E8C89A', outer: '#5E8079' },
    texture: 'flowstone',
    floorMotif: 'pool',
    wallMotif: 'stalactites',
  },
  {
    id: 'crystal',
    name: 'Crystal seam',
    blurb: 'The rock has grown facets. The torch comes back at you from everywhere.',
    wall: { lit: '#3A3A52', dim: '#20202E' },
    wallShaded: { lit: '#2E2E42', dim: '#191926' },
    floor: { lit: '#2C2C40', dim: '#181824' },
    edge: { lit: '#8A9AD8', dim: '#414A6B' },
    glow: { inner: '#9AB8F0', outer: '#6A5A9A' },
    texture: 'facets',
    floorMotif: 'rubble',
  },
  {
    id: 'squeeze',
    name: 'The crawl',
    blurb: 'Rock to both shoulders. You go through this one sideways.',
    wall: { lit: '#4B4038', dim: '#2A2420' },
    wallShaded: { lit: '#3B322C', dim: '#221D1A' },
    floor: { lit: '#33291F', dim: '#1E1813' },
    edge: { lit: '#7A6552', dim: '#3E342C' },
    glow: { inner: '#E8A33D', outer: '#B85C1E' },
    texture: 'strata',
    floorMotif: 'rubble',
    wallMotif: 'squeeze',
  },
  {
    id: 'chasm',
    name: 'The chasm',
    blurb: 'The floor stops. Whatever is under it does not answer.',
    wall: { lit: '#453C36', dim: '#272220' },
    wallShaded: { lit: '#372F2A', dim: '#1F1B19' },
    floor: { lit: '#302823', dim: '#1C1815' },
    edge: { lit: '#7A6552', dim: '#3E342C' },
    glow: { inner: '#E8A33D', outer: '#41525C' },
    texture: 'strata',
    floorMotif: 'chasm',
    openCeiling: true,
  },
  {
    id: 'mine',
    name: 'Cut workings',
    blurb: 'Somebody dug this on purpose, and framed it before it fell in.',
    wall: { lit: '#4A3E2E', dim: '#2A231A' },
    wallShaded: { lit: '#3B3125', dim: '#221C15' },
    floor: { lit: '#382E22', dim: '#201A14' },
    edge: { lit: '#9A7A4A', dim: '#4C3B25' },
    glow: { inner: '#E8A33D', outer: '#B85C1E' },
    texture: 'timbers',
    floorMotif: 'rails',
  },
  {
    id: 'sewer',
    name: 'Storm drain',
    blurb: 'Hard brick, running with something. It carries sound a long way.',
    wall: { lit: '#3E4238', dim: '#232620' },
    wallShaded: { lit: '#313429', dim: '#1C1E19' },
    floor: { lit: '#2C3230', dim: '#191D1C' },
    edge: { lit: '#6E7A5E', dim: '#3A4032' },
    glow: { inner: '#C8D89A', outer: '#41525C' },
    texture: 'brick',
    floorMotif: 'channel',
  },
  {
    id: 'ice',
    name: 'Frozen',
    blurb: 'Cracked through, and cold enough that the torch does nothing for you.',
    wall: { lit: '#3A4A52', dim: '#20292E' },
    wallShaded: { lit: '#2E3A42', dim: '#192126' },
    floor: { lit: '#31434A', dim: '#1B252A' },
    edge: { lit: '#9AC8D8', dim: '#4A6470' },
    glow: { inner: '#BEE0F0', outer: '#41525C' },
    texture: 'frost',
    floorMotif: 'pool',
  },
  {
    id: 'forge',
    name: 'The forge',
    blurb: 'Still warm. Whatever was being made here, they left in a hurry.',
    wall: { lit: '#52362E', dim: '#2E1E1A' },
    wallShaded: { lit: '#422B24', dim: '#251815' },
    floor: { lit: '#42281E', dim: '#251712' },
    edge: { lit: '#C87A3A', dim: '#5E3A20' },
    glow: { inner: '#F08A3A', outer: '#8C2F22' },
    texture: 'brick',
    floorMotif: 'grate',
  },
  {
    id: 'hull',
    name: 'Ship’s hull',
    blurb: 'Tarred timber and ribs. Something groans below the waterline.',
    wall: { lit: '#4A3626', dim: '#2A1F16' },
    wallShaded: { lit: '#3B2B1E', dim: '#221912' },
    floor: { lit: '#3A2A1C', dim: '#211811' },
    edge: { lit: '#8A6A44', dim: '#43331F' },
    glow: { inner: '#E8A33D', outer: '#B85C1E' },
    texture: 'planks',
    floorMotif: 'none',
  },
  {
    id: 'flooded',
    name: 'Flooded lagoon',
    blurb: 'Standing water to the ankle. The light moves on the walls.',
    wall: { lit: '#3E4A48', dim: '#212B2A' },
    wallShaded: { lit: '#323C3B', dim: '#1B2322' },
    floor: { lit: '#2A4249', dim: '#16262B' },
    edge: { lit: '#5E8079', dim: '#31423E' },
    glow: { inner: '#E8A33D', outer: '#41525C' },
    texture: 'strata',
    floorMotif: 'water',
  },
  {
    id: 'grove',
    name: 'Inside the tree',
    blurb: 'Living wood, grain running upward. The walls are warm.',
    wall: { lit: '#4C3D24', dim: '#2B2315' },
    wallShaded: { lit: '#3D311D', dim: '#231C11' },
    floor: { lit: '#3A3320', dim: '#211D12' },
    edge: { lit: '#8A7A3E', dim: '#453D22' },
    glow: { inner: '#E8C23D', outer: '#7A8A2E' },
    texture: 'bark',
    floorMotif: 'none',
  },
  {
    id: 'chapel',
    name: 'Chapel',
    blurb: 'Vaulted and quiet. Somebody kneels here.',
    wall: { lit: '#4A4038', dim: '#2A2521' },
    wallShaded: { lit: '#3B342E', dim: '#231F1B' },
    floor: { lit: '#3B322A', dim: '#221E1A' },
    edge: { lit: '#9A8464', dim: '#4B4132' },
    glow: { inner: '#F0C878', outer: '#B85C1E' },
    texture: 'tiles',
    floorMotif: 'none',
  },
  {
    id: 'ossuary',
    name: 'Bone house',
    blurb: 'Stacked and sorted remains. Somebody was tidy about it.',
    wall: { lit: '#4A463C', dim: '#2A2823' },
    wallShaded: { lit: '#3A3730', dim: '#22201C' },
    floor: { lit: '#37332B', dim: '#201E19' },
    edge: { lit: '#A39A80', dim: '#4E4A3E' },
    glow: { inner: '#E8DCC0', outer: '#8C2F22' },
    texture: 'bone',
    floorMotif: 'rubble',
  },
  {
    id: 'hallway',
    name: 'Endless hallway',
    blurb: 'Doors and more doors. You have been here before.',
    wall: { lit: '#463A34', dim: '#28211E' },
    wallShaded: { lit: '#382E29', dim: '#211B18' },
    floor: { lit: '#332B26', dim: '#1E1916' },
    edge: { lit: '#6B5A47', dim: '#3A3129' },
    texture: 'tiles',
    floorMotif: 'grate',
    wallMotif: 'receding',
    glow: { inner: '#E8A33D', outer: '#41525C' },
  },
  {
    id: 'smoke',
    name: 'Smoke den',
    blurb: 'Warm, hazy, low. The air is doing something to you.',
    wall: { lit: '#523A2E', dim: '#2E211A' },
    wallShaded: { lit: '#422E25', dim: '#251A15' },
    floor: { lit: '#3E2C22', dim: '#231913' },
    edge: { lit: '#9A6A4A', dim: '#4C3527' },
    glow: { inner: '#F0A85A', outer: '#B85C1E' },
    texture: 'ribs',
    floorMotif: 'sand',
  },
  {
    id: 'void',
    name: 'The void',
    blurb: 'No walls at all. For dreams, and for whatever the weed did.',
    wall: { lit: '#191423', dim: '#100D18' },
    wallShaded: { lit: '#141020', dim: '#0C0A14' },
    floor: { lit: '#1D1730', dim: '#120F1E' },
    edge: { lit: '#6A5A9A', dim: '#332B4A' },
    glow: { inner: '#B08CE8', outer: '#41525C' },
    texture: 'none',
    floorMotif: 'none',
    openCeiling: true,
    openWalls: true,
  },
]

const BY_ID = new Map(ROOM_DESIGNS.map((d) => [d.id, d]))

/** Unknown ids fall back to stone rather than throwing, so a design removed by
 *  a later migration cannot break a room that still references it. */
export function designFor(id: string | null | undefined): RoomDesign {
  return BY_ID.get(id ?? '') ?? ROOM_DESIGNS[0]
}

export const DEFAULT_DESIGN = ROOM_DESIGNS[0].id
