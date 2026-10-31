import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { addCharacter, addFight, addLines, addReactionLines, addVar, choiceOf, idOf, makeGraph, setOutcome } from '@/test/factory'
import { buildDemoStory } from '@/features/demo/demoStory'
import { PlaytestEngine, type PlaytestState, type Turn } from '@/features/playtest/engine'
import type { Effect, Gate, GateExpression, StoryGraph } from '@/types/domain'
import { buildStoryPack } from './storyPack'
import { graphFromRows, rowsFromGraph, type StoryRows } from './fromRows'
import { splitNarration } from '@/features/cast/dialogue'

/**
 * Golden sessions: the TypeScript engine, recorded, for the Kotlin engine to
 * replay.
 *
 * Each fixture story is packed with `buildStoryPack`, then walked by seeded
 * random key presses (and timeouts) through `PlaytestEngine`. Every turn —
 * what was heard and the state it left — is written beside the pack under
 * `android/engine/src/test/resources/golden/`. `GoldenSessionsTest.kt` loads
 * the same pack, presses the same keys and must hear the same things.
 *
 * This test FAILS when the TypeScript engine's behaviour changes, which is the
 * point: regenerate with `JD_UPDATE_GOLDEN=1 pnpm test golden`, and the Kotlin
 * test will then fail until the port is brought into step.
 */

const OUT = resolve(__dirname, '../../../android/engine/src/test/resources/golden')
const UPDATE = process.env.JD_UPDATE_GOLDEN === '1'

/** Keys a caller might press, weighted toward the ones that usually do something. */
const KEYS = ['1', '1', '2', '2', '3', '3', '4', '5', '9', '0', '*', '#', 'T', 'T']
const SEEDS = 24
const STEPS = 50

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const stateOf = (s: PlaytestState) => ({
  node: s.nodeId,
  mask: s.caller.mask,
  counters: s.caller.counters,
  path: s.path.join(' '),
  failed: s.failedAttempts,
  finished: s.finished,
  round: s.fightRound,
  silences: s.fightSilences,
})

const heardOf = (t: Turn) =>
  t.heard.map((p) => ({ id: p.id, audio: p.audioPath, say: p.say, speaker: p.speaker }))

function record(graph: StoryGraph, scripts: string[][] = []) {
  const engine = new PlaytestEngine(graph)
  const sessions = []
  // Scripted sessions first (seed 0, -1, …): routes a random walk rarely finds.
  const runs = [...scripts.map((keys, i) => ({ seed: -i, keys })), ...Array.from({ length: SEEDS }, (_, i) => ({ seed: i + 1, keys: null as string[] | null }))]
  for (const { seed, keys } of runs) {
    const rand = mulberry32(seed)
    let state = engine.start()
    const steps: unknown[] = [
      { key: 'START', heard: engine.arrival(state).map((p) => ({ id: p.id, audio: p.audioPath, say: p.say, speaker: p.speaker })), state: stateOf(state) },
    ]
    for (let i = 0; i < (keys ? keys.length : STEPS); i++) {
      if (state.finished && !keys) {
        state = engine.start()
        steps.push({ key: 'START', heard: heardOf({ next: state, heard: engine.arrival(state) }), state: stateOf(state) })
        continue
      }
      const key = keys ? keys[i] : KEYS[Math.floor(rand() * KEYS.length)]
      const turn = key === 'T' ? engine.timeout(state) : engine.press(state, key)
      state = turn.next
      steps.push({ key, heard: heardOf(turn), state: stateOf(state), held: engine.held(state) })
    }
    sessions.push({ seed, steps })
  }
  return sessions
}

// ---------------------------------------------------------------------------
// Fixtures

function gate(graph: StoryGraph, choiceId: string, expression: GateExpression, patch: Partial<Gate> = {}) {
  const g: Gate = {
    id: `g-${choiceId}`,
    story_id: graph.story.id,
    choice_id: choiceId,
    expression,
    fail_behavior: 'refuse',
    fail_narration: null,
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: false,
    created_at: '',
    updated_at: '',
    ...patch,
  }
  graph.gates.set(g.id, g)
}

let effectSeq = 0
function effect(graph: StoryGraph, owner: { node?: string; choice?: string }, varSlug: string, operation: Effect['operation'], amount: number | null = null) {
  const v = [...graph.stateVars.values()].find((x) => x.slug === varSlug)!
  const id = `e${++effectSeq}`
  graph.effects.set(id, {
    id,
    story_id: graph.story.id,
    node_id: owner.node ?? null,
    choice_id: owner.choice ?? null,
    state_var_id: v.id,
    operation,
    amount,
    sort_order: effectSeq,
    created_at: '',
  })
}

/** Every rule the engine has, in one small story. */
function kitchenSink(): StoryGraph {
  effectSeq = 0
  const g = makeGraph(
    ['HALL', 'PANTRY', 'CELLAR', 'DOOR', 'VAULT', 'FIGHT', 'WON', 'DEAD', 'LOST', 'ESCAPE'],
    [
      'HALL>PANTRY', 'HALL>CELLAR', 'HALL>DOOR', 'HALL>', 'HALL>HALL',
      'PANTRY>HALL',
      'CELLAR>HALL', 'CELLAR>FIGHT',
      'DOOR>VAULT', 'DOOR>WON', 'DOOR>HALL', 'DOOR>ESCAPE',
      'VAULT>ESCAPE', 'VAULT>HALL',
      'WON>HALL',
    ],
    { endings: ['DEAD', 'LOST', 'ESCAPE'], wins: ['ESCAPE'], recorded: ['HALL', 'VAULT'] },
  )
  g.story.counter_clamp = 3
  g.story.inventory_key = '#'
  g.story.inventory_intro_audio_path = 'audio/inv-intro.wav'

  addVar(g, 'KEY', { name: 'A brass key', is_consumable: true, gain_narration: 'Cold in the hand.', spend_narration: 'The key snaps off in the lock.', audio_path: 'audio/key.wav' })
  addVar(g, 'CROWBAR', { name: 'A crowbar', is_consumable: true, gain_narration: 'Heavy.', gain_audio_path: 'audio/crowbar-gain.wav' })
  addVar(g, 'LAMP', { kind: 'flag', name: 'Lamp lit' })
  addVar(g, 'CURSE', { kind: 'flag', name: 'Cursed' })
  addVar(g, 'COINS', { kind: 'counter', name: 'Coins', gain_narration: 'A coin clinks.' })

  effect(g, { choice: choiceOf(g, 'HALL', 'PANTRY') }, 'KEY', 'grant')
  effect(g, { node: idOf(g, 'PANTRY') }, 'COINS', 'add', 1)
  effect(g, { node: idOf(g, 'PANTRY') }, 'LAMP', 'grant')
  effect(g, { choice: choiceOf(g, 'CELLAR', 'HALL') }, 'CROWBAR', 'grant')
  effect(g, { choice: choiceOf(g, 'CELLAR', 'HALL') }, 'CURSE', 'grant')
  effect(g, { choice: choiceOf(g, 'CELLAR', 'HALL') }, 'CROWBAR', 'grant')
  effect(g, { node: idOf(g, 'VAULT') }, 'COINS', 'set', 0)
  effect(g, { node: idOf(g, 'WON') }, 'COINS', 'add', 5)
  effect(g, { node: idOf(g, 'WON') }, 'CURSE', 'revoke')

  const door = (to: string) => choiceOf(g, 'DOOR', to)
  gate(g, door('VAULT'), { op: 'or', args: [{ op: 'has', var: 'KEY' }, { op: 'has', var: 'CROWBAR' }] }, { consume_on_pass: true })
  gate(g, door('WON'), { op: 'and', args: [{ op: 'gte', var: 'COINS', value: 2 }, { op: 'lte', var: 'COINS', value: 3 }] }, { fail_narration: 'Not enough coin.', fail_audio_path: 'audio/poor.wav' })
  gate(g, door('HALL'), { op: 'has', var: 'LAMP' }, { fail_behavior: 'hide' })
  gate(g, door('ESCAPE'), { op: 'and', args: [{ op: 'not', args: [{ op: 'has', var: 'CURSE' }] }, { op: 'lacks', var: 'KEY' }] }, { fail_behavior: 'divert', fail_node_id: idOf(g, 'DEAD') })
  gate(g, choiceOf(g, 'VAULT', 'ESCAPE'), { op: 'eq', var: 'COINS', value: 0 })
  gate(g, choiceOf(g, 'VAULT', 'HALL'), { op: 'and', args: [] }, { fail_behavior: 'refuse' })

  const esc = g.choices.get(door('ESCAPE'))!
  esc.reaction_narration = 'The hinges scream.'
  esc.audio_path = 'audio/hinges.wav'

  addCharacter(g, 'CARTER')
  addCharacter(g, 'MIKE')
  addLines(g, 'HALL', ['CARTER|Who is there?', 'MIKE|Nobody.', 'A draught.'], { recorded: true })
  addReactionLines(g, choiceOf(g, 'HALL', 'CELLAR'), ['MIKE|Mind the steps.', 'CARTER|I see them.'])

  addFight(g, 'FIGHT', { moves: ['PUNCH beats kick', 'KICK beats punch', 'DUCK'], rounds: ['kick', 'punch', 'kick'], win: 'WON', lose: 'LOST', patience: 2 })
  setOutcome(g, 'FIGHT', 1, 2, 'ESCAPE')
  setOutcome(g, 'FIGHT', 2, 2, null)

  const cellar = g.nodes.get(idOf(g, 'CELLAR'))!
  cellar.invalid_target_id = idOf(g, 'DEAD')
  const pantry = g.nodes.get(idOf(g, 'PANTRY'))!
  pantry.timeout_target_id = idOf(g, 'HALL')
  const vault = g.nodes.get(idOf(g, 'VAULT'))!
  vault.narration = ''
  vault.audio_path = null
  return g
}

/**
 * The real stories, as rows copied from Supabase (checksummed against the
 * database when they were taken). Not a backup and not kept in step with the
 * live data: they are here because a real story exercises the engines in ways
 * an invented one doesn't, and they also ship inside the Android app.
 */
const real = (name: string) => () =>
  graphFromRows(JSON.parse(readFileSync(resolve(__dirname, `fixtures/${name}.rows.json`), 'utf8')) as StoryRows)

const FIXTURES: Record<string, { build: () => StoryGraph; scripts: string[][] }> = {
  william: {
    build: real('william'),
    scripts: [
      // As Carter, take the helmet: the swamp's fork lets you through to Forest 1.
      ['2', '1', '1', '1', '1', '2', '2', '1', '1', '1', '1', '#'],
      // Leave the helmet behind: the same door forks you to Forest 2 instead.
      ['2', '1', '1', '3', '1', '2', '2', '1', 'T'],
      // As Mike, all the way to the shark.
      ['1', '1', '1', '1', '2', '1', '1', '2', '1', '2', '3', '1'],
    ],
  },
  jcfc: { build: real('jcfc'), scripts: [['1', '3', '1', '1', '*', '0', '#']] },
  demo: { build: buildDemoStory, scripts: [['2', '1', '1', '1', '1', '1', '1']] },
  kitchen: {
    build: kitchenSink,
    scripts: [
      // Cellar, fight, three right answers: win, clamp the coins, lose the curse.
      ['2', '2', '1', '2', '1', '1', '#', '3', '2', '1', '1', '#'],
      // Pantry for the key, then the door: the OR gate spends only the key.
      ['1', 'T', '3', '1', '#', '1'],
      // Crowbar and curse from the cellar, then the door's divert.
      ['2', '1', '3', '4', 'T'],
    ],
  },
}

/**
 * Every script in every fixture, split by speaker — plus the awkward shapes —
 * for the Kotlin port of `splitNarration`. The phone edits scripts, so it has
 * to split them exactly the way the web app did.
 */
const SPLIT_EXTRAS = [
  'Carter: hi. Mike: hello! Carter:no space',
  'and then, Carter: run',
  'SFX: a door slams\nNote: record twice',
  'Mike and Carter: Hey why',
  'A Very Long Speaker Name Here: words',
  'Mike:   \nCarter: only me',
  '  leading spaces\n\n\ttabs\t',
  'Dr. Who: yes. Mr. T: no.',
  'Time: 5 o\u2019clock. Ok.',
  '"Quoted." Shark King: hi',
  '',
]

describe('golden sessions for the Kotlin engine', () => {
  it('splits: every script, as splitNarration sees it', () => {
    const texts = new Set<string>(SPLIT_EXTRAS)
    for (const { build } of Object.values(FIXTURES)) {
      const g = build()
      for (const n of g.nodes.values()) texts.add(n.narration)
      for (const c of g.choices.values()) if (c.reaction_narration) texts.add(c.reaction_narration)
    }
    const body = JSON.stringify([...texts].map((text) => ({ text, lines: splitNarration(text) }))) + '\n'
    const path = resolve(OUT, 'splits.json')
    if (UPDATE || !existsSync(path)) writeFileSync(path, body)
    expect(readFileSync(path, 'utf8'), 'splits.json is stale: JD_UPDATE_GOLDEN=1 pnpm test golden').toBe(body)
  })

  for (const [name, { build, scripts }] of Object.entries(FIXTURES)) {
    it(`${name}: the recorded sessions still describe the engine`, () => {
      const graph = build()
      const files = {
        // The rows too, so the Kotlin pack builder can be held to this one.
        [`${name}.rows.json`]: JSON.stringify(rowsFromGraph(graph)) + '\n',
        [`${name}.pack.json`]: JSON.stringify(buildStoryPack(graph), null, 1) + '\n',
        [`${name}.sessions.json`]: JSON.stringify(record(graph, scripts)) + '\n',
      }
      for (const [file, body] of Object.entries(files)) {
        const path = resolve(OUT, file)
        if (UPDATE || !existsSync(path)) {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, body)
        }
        expect(readFileSync(path, 'utf8'), `${file} is stale: JD_UPDATE_GOLDEN=1 pnpm test golden`).toBe(body)
      }
    })
  }
})
