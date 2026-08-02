import { describe, expect, it } from 'vitest'
import { idOf, makeGraph } from '@/test/factory'
import { deriveGraph } from '@/features/graph/derived'
import { compileStory } from './compile'
import { audioManifestCsv, buildSheet, printableScript, storyJson, studioFlowJson } from './outputs'

const BASE = 'https://x.supabase.co/storage/v1/object/public/story-audio/'

const sample = () =>
  makeGraph(['ENTRANCE', 'HULL', 'FIN'], ['ENTRANCE>HULL', 'HULL>FIN', 'HULL>'], {
    endings: ['FIN'],
    recorded: ['HULL'],
  })

describe('build sheet', () => {
  it('orders rooms shallowest first', () => {
    const g = sample()
    const sheet = buildSheet(g, compileStory(g, BASE), deriveGraph(g).depth)
    expect(sheet.indexOf('─── ENTRANCE')).toBeLessThan(sheet.indexOf('─── HULL'))
    expect(sheet.indexOf('─── HULL')).toBeLessThan(sheet.indexOf('─── FIN'))
  })

  it('marks a transition that points further down the sheet', () => {
    // ENTRANCE's gather targets HULL_play, which is defined in a later section.
    // Claiming otherwise would send someone hunting for a widget that isn't there.
    const g = sample()
    const sheet = buildSheet(g, compileStory(g, BASE), deriveGraph(g).depth)
    expect(sheet).toMatch(/HULL_play\s+\(later\)/)
  })

  it('surfaces compile warnings before the steps', () => {
    const g = sample()
    const compiled = compileStory(g, BASE)
    const sheet = buildSheet(g, compiled, deriveGraph(g).depth)
    expect(sheet.indexOf('BEFORE YOU START')).toBeLessThan(sheet.indexOf('─── ENTRANCE'))
    expect(sheet).toContain('unwritten branch')
  })

  it('includes the patience valve instruction', () => {
    const g = sample()
    expect(buildSheet(g, compileStory(g, BASE))).toContain('PATIENCE VALVE')
  })
})

describe('studio flow json', () => {
  it('starts at a trigger wired to the entrance', () => {
    const g = sample()
    const entrance = g.nodes.get(idOf(g, 'ENTRANCE'))!
    g.nodes.set(entrance.id, { ...entrance, audio_path: 'audio/ENTRANCE.mp3' })
    const flow = JSON.parse(studioFlowJson(g, compileStory(g, BASE), new Map()))
    expect(flow.initial_state).toBe('Trigger')
    const trigger = flow.states.find((s: { name: string }) => s.name === 'Trigger')
    expect(
      trigger.transitions.find((t: { event: string }) => t.event === 'incomingCall').next,
    ).toBe('ENTRANCE_play')
  })

  it('starts at the first widget that exists when the entrance is unrecorded', () => {
    // No recording means no play widget, so wiring the trigger to `_play` by
    // name would point the whole flow at nothing.
    const g = sample()
    const flow = JSON.parse(studioFlowJson(g, compileStory(g, BASE), new Map()))
    const trigger = flow.states.find((s: { name: string }) => s.name === 'Trigger')
    const next = trigger.transitions.find((t: { event: string }) => t.event === 'incomingCall').next
    expect(next).toBe('ENTRANCE_gather')
    expect(flow.states.some((s: { name: string }) => s.name === next)).toBe(true)
  })

  it('uses automap coordinates when given them', () => {
    const g = sample()
    const positions = new Map([[idOf(g, 'HULL'), { x: 120, y: 340 }]])
    const flow = JSON.parse(studioFlowJson(g, compileStory(g, BASE), positions))
    const play = flow.states.find((s: { name: string }) => s.name === 'HULL_play')
    expect(play.properties.offset).toEqual({ x: 120, y: 340 })
  })
})

describe('other outputs', () => {
  it('writes a manifest row per room, escaping quotes', () => {
    const g = sample()
    const n = g.nodes.get(idOf(g, 'HULL'))!
    g.nodes.set(n.id, { ...n, title: 'The "groaning" hull' })
    const csv = audioManifestCsv(g)
    expect(csv.split('\n')).toHaveLength(4) // header + 3 rooms
    expect(csv).toContain('"The ""groaning"" hull"')
  })

  it('round-trips the whole story as JSON', () => {
    const g = sample()
    const parsed = JSON.parse(storyJson(g))
    expect(parsed.nodes).toHaveLength(3)
    expect(parsed.choices).toHaveLength(3)
    expect(parsed.story.title).toBe(g.story.title)
  })

  it('writes a VO script with the prompts spelled out', () => {
    const g = sample()
    const script = printableScript(g)
    expect(script).toContain('## ENTRANCE')
    expect(script).toContain('Press 1 to')
  })
})
