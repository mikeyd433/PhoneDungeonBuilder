import type { StoryGraph } from '@/types/domain'
import { PATIENCE_VALVE_AT, type CompileResult, type Widget } from './compile'
import { formatDuration } from '@/lib/speech'

/**
 * §6.6 path B — the build sheet.
 *
 * A printable, ordered checklist for building the flow by hand in the Studio
 * canvas, in dependency order so you never wire a transition to a widget that
 * doesn't exist yet. §6.6 recommends this first: it is a pure rendering of data
 * we already have, and it unblocks immediately.
 */
export function buildSheet(
  graph: StoryGraph,
  compiled: CompileResult,
  depth?: Map<string, number>,
): string {
  const out: string[] = []
  const byNode = new Map<string, Widget[]>()
  for (const w of compiled.widgets) {
    const key = w.nodeId ?? '—'
    if (!byNode.has(key)) byNode.set(key, [])
    byNode.get(key)!.push(w)
  }

  // Shallowest rooms first, so working through the sheet means descending the
  // dungeon the way a caller does.
  const sections = [...byNode.entries()].sort(([a], [b]) => {
    const da = depth?.get(a) ?? Number.MAX_SAFE_INTEGER
    const db = depth?.get(b) ?? Number.MAX_SAFE_INTEGER
    if (da !== db) return da - db
    return (graph.nodes.get(a)?.slug ?? '').localeCompare(graph.nodes.get(b)?.slug ?? '')
  })

  // Every widget name that exists anywhere, so forward references can be marked.
  const known = new Set(compiled.widgets.map((w) => w.name))
  const placed = new Set<string>()

  out.push(`${graph.story.title} — Twilio Studio build sheet`)
  out.push('='.repeat(60))
  out.push('')
  out.push(`Widgets: ${compiled.budget.total} of ${compiled.budget.limit}`)
  out.push(`Longest route: ~${compiled.longestPathSteps} steps (cap is 1000 per call)`)
  out.push('')
  out.push('Rooms are ordered shallowest first, so working down this sheet means')
  out.push('descending the dungeon.')
  out.push('')
  out.push('A dungeon loops, so some transitions necessarily point at rooms further')
  out.push('down the sheet. Those are marked (later) — drop the widget in now and')
  out.push('wire that transition once you reach its target, or place every widget')
  out.push('first and wire the whole flow afterwards.')
  out.push('')

  if (compiled.warnings.length > 0) {
    out.push('BEFORE YOU START — things to check:')
    for (const w of compiled.warnings) out.push(`  ! ${w}`)
    out.push('')
  }

  // Rooms in depth order would be ideal, but insertion order already follows
  // the node list, and dependency correctness comes from every transition
  // targeting a name rather than a position.
  for (const [nodeId, widgets] of sections) {
    const node = graph.nodes.get(nodeId)
    if (!node) continue
    const d = depth?.get(nodeId)
    out.push(
      `─── ${node.slug}  (${node.node_type}${d !== undefined ? `, depth ${d}` : ''}${
        node.audio_path ? ', recorded' : ', no audio yet'
      }) ${'─'.repeat(16)}`,
    )
    for (const w of widgets) placed.add(w.name)
    widgets.forEach((w, i) => {
      out.push(` ${i + 1}. ${widgetLabel(w.type).padEnd(18)} ${w.name}`)
      if (w.note) out.push(`      # ${w.note}`)
      if (w.playUrl) out.push(`      Play URL: ${w.playUrl}`)
      if (w.say) out.push(`      Say: ${w.say}`)
      if (w.splitOn) out.push(`      Split on: ${w.splitOn}`)
      for (const v of w.variables ?? []) {
        out.push(`      ${v.key} = ${v.value}`)
      }
      for (const t of w.transitions) {
        const label = t.condition ?? t.event
        const forward = t.next && known.has(t.next) && !placed.has(t.next) ? '  (later)' : ''
        out.push(`      → ${label.padEnd(22)} : ${t.next ?? '(nowhere)'}${forward}`)
      }
      out.push('')
    })
  }

  out.push('')
  out.push('PATIENCE VALVE')
  out.push(
    `Studio stops an execution if the same widget runs 10 times in a row, so a caller`,
  )
  out.push(
    `mashing a locked door gets hung up on. Route the ${PATIENCE_VALVE_AT}th consecutive refusal to an`,
  )
  out.push('escape node instead of back to the gather.')
  return out.join('\n')
}

function widgetLabel(type: Widget['type']): string {
  switch (type) {
    case 'say-play':
      return 'Say/Play'
    case 'gather-input-on-call':
      return 'Gather'
    case 'set-variables':
      return 'Set Variables'
    case 'split-based-on':
      return 'Split Based On'
    case 'hangup':
      return 'Hangup'
  }
}

/**
 * §6.6 path A — the flow definition JSON, with x/y from the same elkjs layout
 * that drives the automap so an imported flow lands readable instead of piled
 * in a corner.
 */
export function studioFlowJson(
  graph: StoryGraph,
  compiled: CompileResult,
  positions: Map<string, { x: number; y: number }>,
): string {
  let fallbackY = 0
  const states = compiled.widgets.map((w) => {
    const p = w.nodeId ? positions.get(w.nodeId) : undefined
    const at = p ?? { x: 0, y: (fallbackY += 200) }
    return {
      name: w.name,
      type: w.type,
      properties: {
        offset: { x: Math.round(at.x), y: Math.round(at.y) },
        ...(w.say ? { say: w.say } : {}),
        ...(w.playUrl ? { play: w.playUrl } : {}),
        ...(w.splitOn ? { input: w.splitOn } : {}),
        ...(w.variables ? { variables: w.variables } : {}),
      },
      transitions: w.transitions.map((t) => ({
        event: t.event,
        ...(t.condition ? { conditions: [{ friendly_name: t.condition }] } : {}),
        next: t.next ?? undefined,
      })),
    }
  })

  const rootSlug = graph.story.root_node_id
    ? graph.nodes.get(graph.story.root_node_id)?.slug
    : undefined

  return JSON.stringify(
    {
      description: graph.story.title,
      states: [
        {
          name: 'Trigger',
          type: 'trigger',
          properties: { offset: { x: 0, y: -150 } },
          transitions: [
            { event: 'incomingCall', next: rootSlug ? `${rootSlug}_play` : undefined },
            { event: 'incomingMessage' },
            { event: 'incomingRequest' },
          ],
        },
        ...states,
      ],
      initial_state: 'Trigger',
      flags: { allow_concurrent_calls: true },
    },
    null,
    2,
  )
}

/** F6.2 — audio manifest for tracking VO sessions. */
export function audioManifestCsv(graph: StoryGraph): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const rows = [['slug', 'title', 'status', 'filename', 'duration', 'words'].join(',')]
  for (const n of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    rows.push(
      [
        esc(n.slug),
        esc(n.title),
        esc(n.status),
        esc(n.audio_path ?? ''),
        esc(n.audio_duration_ms ? formatDuration(n.audio_duration_ms) : ''),
        String(n.narration.trim() ? n.narration.trim().split(/\s+/).length : 0),
      ].join(','),
    )
  }
  return rows.join('\n')
}

/** F6.3 — full backup, so the whole thing round-trips. */
export function storyJson(graph: StoryGraph): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: null, // stamped by the caller; kept out so the payload is deterministic
      story: graph.story,
      nodes: [...graph.nodes.values()],
      choices: [...graph.choices.values()],
      stateVars: [...graph.stateVars.values()],
      effects: [...graph.effects.values()],
      gates: [...graph.gates.values()],
    },
    null,
    2,
  )
}

/** F6.5 — a printable script for VO talent, one room per section. */
export function printableScript(graph: StoryGraph): string {
  const out: string[] = [graph.story.title, '='.repeat(60), '']
  const nodes = [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  for (const n of nodes) {
    out.push(`## ${n.slug}${n.title ? ` — ${n.title}` : ''}`)
    if (n.status === 'approved') out.push('(approved)')
    else if (n.audio_path) out.push('(recorded, not yet approved)')
    out.push('')
    out.push(n.narration || '(nothing written yet)')
    const exits = [...graph.choices.values()]
      .filter((c) => c.from_node_id === n.id)
      .sort((a, b) => a.sort_order - b.sort_order)
    if (exits.length > 0) {
      out.push('')
      for (const e of exits) out.push(`   Press ${e.digit} to ${e.label || '…'}`)
    }
    if (n.notes) {
      out.push('')
      out.push(`   [note: ${n.notes}]`)
    }
    out.push('')
    out.push('')
  }
  return out.join('\n')
}
