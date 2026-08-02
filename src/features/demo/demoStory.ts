import type {
  Character,
  Choice,
  DialogueLine,
  Digit,
  Effect,
  Fight,
  FightMove,
  FightRound,
  FightRoundOutcome,
  Gate,
  StateVar,
  Story,
  StoryGraph,
  StoryNode,
} from '@/types/domain'

/**
 * A story that exists only in memory.
 *
 * Opening `/story/demo` runs the whole app — room, automap, ledger, cast,
 * playtest, export — against this, with no account and no database. It is for
 * showing somebody the tool, for reviewing the dressing against real screens
 * rather than a bench, and for working on the UI without a network.
 *
 * It is deliberately NOT a happy path. Every state the app has something to say
 * about is in here somewhere: an unwritten branch, a sealed room, a gate that
 * refuses, a fight with a round nobody has recorded, a conversation half
 * voiced. A demo where everything is finished would hide most of the app.
 */

export const DEMO_STORY_ID = 'demo'

const STAMP = '2026-01-01T00:00:00Z'
const ids = { n: 0 }
const nextId = (prefix: string) => `${prefix}-${++ids.n}`

export function buildDemoStory(): StoryGraph {
  ids.n = 0

  const story: Story = {
    id: DEMO_STORY_ID,
    title: 'The Delve — walkthrough',
    root_node_id: null,
    owner_id: 'demo-owner',
    counter_clamp: 10,
    default_fail_behavior: 'refuse',
    inventory_key: null,
    inventory_intro_audio_path: null,
    inventory_intro_audio_duration_ms: null,
    inventory_empty_audio_path: null,
    inventory_empty_audio_duration_ms: null,
    created_at: STAMP,
    updated_at: STAMP,
  }

  const nodes = new Map<string, StoryNode>()
  const bySlug = new Map<string, string>()

  const room = (
    slug: string,
    title: string,
    narration: string,
    extra: Partial<StoryNode> = {},
  ): string => {
    const id = nextId('n')
    bySlug.set(slug, id)
    nodes.set(id, {
      id,
      story_id: story.id,
      slug,
      title,
      narration,
      node_type: 'room',
      audio_path: null,
      audio_duration_ms: null,
      status: 'scripted',
      notes: null,
      timeout_target_id: null,
      invalid_target_id: null,
      timeout_seconds: 5,
      room_design: 'stone',
      created_at: STAMP,
      updated_at: STAMP,
      ...extra,
    })
    return id
  }

  const entrance = room(
    'ENTRANCE',
    'The hotline',
    'You have reached the JCFC hotline. A door swings open onto black water.',
    { room_design: 'stone', audio_path: 'demo/entrance.mp3', audio_duration_ms: 7400, status: 'approved' },
  )
  const deck = room('DECK', 'The listing deck', 'The deck tilts. Something circles below the waterline.', {
    room_design: 'hull',
    audio_path: 'demo/deck.mp3',
    audio_duration_ms: 5200,
    status: 'recorded',
  })
  const hold = room('HOLD', 'The flooded hold', 'Water to the ankle. A coil of rope floats past.', {
    room_design: 'flooded',
    audio_path: 'demo/hold.mp3',
    audio_duration_ms: 4800,
    status: 'recorded',
  })
  const sharks = room('SHARKS', 'Circled', 'It surfaces. It has been waiting.', {
    room_design: 'cavern',
    audio_path: 'demo/sharks.mp3',
    audio_duration_ms: 3100,
    status: 'recorded',
  })
  const shore = room(
    'SHORE',
    'The shore',
    'Carter: You are bleeding.\nMike: I know what I am.\nCarter: We are not doing that again.',
    { room_design: 'grove' },
  )
  const drowned = room('DROWNED', 'Down', 'The water closes. The line goes dead.', {
    node_type: 'ending',
    room_design: 'void',
    audio_path: 'demo/drowned.mp3',
    audio_duration_ms: 2600,
    status: 'approved',
  })
  const locker = room('LOCKER', 'The locker', 'Bolted shut. The rope would hold your weight.', {
    room_design: 'ossuary',
  })
  const fin = room('FIN', 'Ashore', 'You make it out. You do not look back.', {
    node_type: 'ending',
    room_design: 'chapel',
  })
  room('CUT_SCENE', 'A room nothing leads to', 'Written, then stranded.', { room_design: 'smoke' })

  story.root_node_id = entrance

  const choices = new Map<string, Choice>()
  const exit = (from: string, digit: string, label: string, to: string | null): string => {
    const id = nextId('c')
    choices.set(id, {
      id,
      story_id: story.id,
      from_node_id: from,
      digit: digit as Digit,
      label,
      to_node_id: to,
      reaction_narration: null,
      audio_path: null,
      audio_duration_ms: null,
      sort_order: Number(digit) || 0,
      created_at: STAMP,
      updated_at: STAMP,
    })
    return id
  }

  exit(entrance, '1', 'go up on deck', deck)
  exit(entrance, '2', 'go below', hold)
  exit(entrance, '3', 'listen to the music', null) // a bricked archway
  exit(deck, '1', 'dive', sharks)
  const swim = exit(hold, '1', 'swim for it', sharks)
  exit(shore, '1', 'walk inland', fin)
  const force = exit(shore, '2', 'force the locker', locker)
  exit(locker, '1', 'climb out', fin)

  // An item, granted by a choice, and a gate that wants it.
  const stateVars = new Map<string, StateVar>()
  const rope: StateVar = {
    id: nextId('v'),
    story_id: story.id,
    slug: 'ROPE',
    name: 'A coil of rope',
    kind: 'item',
    description: 'Floats past in the hold.',
    is_consumable: false,
    audio_path: null,
    audio_duration_ms: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
  stateVars.set(rope.id, rope)

  const effects = new Map<string, Effect>()
  const grant: Effect = {
    id: nextId('e'),
    story_id: story.id,
    node_id: null,
    choice_id: swim,
    state_var_id: rope.id,
    operation: 'grant',
    amount: null,
    sort_order: 0,
    created_at: STAMP,
  }
  effects.set(grant.id, grant)

  const gates = new Map<string, Gate>()
  const gate: Gate = {
    id: nextId('g'),
    story_id: story.id,
    choice_id: force,
    expression: { op: 'has', var: 'ROPE' },
    fail_behavior: 'refuse',
    fail_narration: 'The locker will not give. You would need something to haul on.',
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: false,
    created_at: STAMP,
    updated_at: STAMP,
  }
  gates.set(gate.id, gate)

  // Cast.
  const characters = new Map<string, Character>()
  const cast = (slug: string, name: string, actor: string | null, color: string, playable: boolean) => {
    const c: Character = {
      id: nextId('ch'),
      story_id: story.id,
      slug,
      name,
      is_playable: playable,
      voice_actor: actor,
      color,
      notes: null,
      created_at: STAMP,
      updated_at: STAMP,
    }
    characters.set(c.id, c)
    return c.id
  }
  const mike = cast('MIKE', 'Mike', 'Mike D', 'torch', true)
  const carter = cast('CARTER', 'Carter', 'Carter B', 'ember', true)
  cast('SHARK', 'The shark', 'Mike D', 'grave', false)

  // A conversation recorded line by line, with one take still missing — so the
  // room reads as unfinished everywhere it should.
  const dialogue = new Map<string, DialogueLine>()
  const line = (
    node: string,
    character: string | null,
    text: string,
    order: number,
    audio: string | null,
    ms: number | null,
  ) => {
    const l: DialogueLine = {
      id: nextId('dl'),
      story_id: story.id,
      node_id: node,
      character_id: character,
      text,
      sort_order: order,
      audio_path: audio,
      audio_duration_ms: ms,
      created_at: STAMP,
      updated_at: STAMP,
    }
    dialogue.set(l.id, l)
  }
  line(shore, carter, 'You are bleeding.', 0, 'demo/shore-1.mp3', 1900)
  line(shore, mike, 'I know what I am.', 1, null, null)
  line(shore, carter, 'We are not doing that again.', 2, 'demo/shore-3.mp3', 2400)

  // The fight.
  const fights = new Map<string, Fight>()
  const fight: Fight = {
    id: nextId('f'),
    story_id: story.id,
    node_id: sharks,
    opponent_name: 'The shark',
    win_node_id: shore,
    lose_node_id: drowned,
    silence_patience: 3,
    created_at: STAMP,
    updated_at: STAMP,
  }
  fights.set(fight.id, fight)

  const fightMoves = new Map<string, FightMove>()
  ;[
    ['PUNCH', 'punch', 'Rising Tiger'],
    ['KICK', 'kick', 'Low Roll'],
    ['BLOCK', 'block', 'Breach'],
  ].forEach(([slug, label, beats], i) => {
    const m: FightMove = {
      id: nextId('fm'),
      story_id: story.id,
      fight_id: fight.id,
      slug,
      label,
      beats,
      sort_order: i,
      created_at: STAMP,
    }
    fightMoves.set(m.id, m)
  })

  const fightRounds = new Map<string, FightRound>()
  ;[
    ['Rising Tiger', 'Rising Tiger Shark! It comes up under you.', 'demo/r1.mp3', 2200],
    ['Low Roll', 'It rolls low and fast.', 'demo/r2.mp3', 1800],
    ['Breach', 'It breaches. This is the last of it.', null, null],
  ].forEach(([move, narration, audio, ms], i) => {
    const r: FightRound = {
      id: nextId('fr'),
      story_id: story.id,
      fight_id: fight.id,
      sort_order: i,
      opponent_move: move as string,
      narration: narration as string,
      audio_path: audio as string | null,
      audio_duration_ms: ms as number | null,
      created_at: STAMP,
      updated_at: STAMP,
    }
    fightRounds.set(r.id, r)
  })

  return {
    story,
    nodes,
    choices,
    stateVars,
    effects,
    gates,
    characters,
    dialogue,
    fights,
    fightMoves,
    fightRounds,
    fightOutcomes: new Map<string, FightRoundOutcome>(),
  }
}
