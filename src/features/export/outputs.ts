import type { StoryGraph } from '@/types/domain'
import { PATIENCE_VALVE_AT, type CompileResult, type Widget } from './compile'
import { formatDuration } from '@/lib/speech'
import { castList, linesFor, workloads } from '@/features/cast/dialogue'
import { buildFightView } from '@/features/fight/model'

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

  out.push('Nothing in this flow is spoken by Twilio. Anything without a recording is')
  out.push('simply not emitted, so a room, round or refusal with no take is silence on')
  out.push('the phone. The audio manifest lists every one of them.')
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

  return JSON.stringify(
    {
      description: graph.story.title,
      states: [
        {
          name: 'Trigger',
          type: 'trigger',
          properties: { offset: { x: 0, y: -150 } },
          transitions: [
            // The compiler decides where a call starts. An unrecorded entrance
            // has no play widget, and one with arrival effects starts at those.
            { event: 'incomingCall', next: compiled.entryWidget ?? undefined },
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

/**
 * F6.2 — audio manifest for tracking VO sessions.
 *
 * Every recordable thing, not just rooms. Nothing in the exported flow is
 * spoken by Twilio, so a fight round or a refusal without a take is simply
 * silence on the phone — and a manifest that only listed rooms would make that
 * silence invisible right up until somebody called the number.
 */
export function audioManifestCsv(graph: StoryGraph): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const words = (text: string) => String(text.trim() ? text.trim().split(/\s+/).length : 0)
  const rows = [['kind', 'slug', 'title', 'status', 'filename', 'duration', 'words'].join(',')]

  const push = (
    kind: string,
    slug: string,
    title: string,
    status: string,
    path: string | null,
    ms: number | null,
    text: string,
  ) =>
    rows.push(
      [
        esc(kind),
        esc(slug),
        esc(title),
        esc(status),
        esc(path ?? ''),
        esc(ms ? formatDuration(ms) : ''),
        words(text),
      ].join(','),
    )

  for (const n of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const lines = linesFor(graph, n.id)
    const split = lines.some((l) => l.audio_path)

    // A room recorded line by line has no take of its own worth chasing.
    if (!split) {
      push('room', n.slug, n.title, n.status, n.audio_path, n.audio_duration_ms, n.narration)
    }
    if (split) {
      lines.forEach((line, i) => {
        const who = line.character_id ? graph.characters.get(line.character_id) : null
        push(
          'line',
          `${n.slug}#${i + 1}`,
          who?.name ?? '',
          line.audio_path ? 'recorded' : 'missing',
          line.audio_path,
          line.audio_duration_ms,
          line.text,
        )
      })
    }

    const fight = buildFightView(graph, n.id)
    if (fight) {
      fight.rounds.forEach((round, i) => {
        push(
          'fight round',
          `${n.slug}#r${i + 1}`,
          fight.fight.opponent_name,
          round.audio_path ? 'recorded' : 'missing',
          round.audio_path,
          round.audio_duration_ms,
          round.narration,
        )
      })
    }
  }

  for (const gate of graph.gates.values()) {
    if (gate.fail_behavior !== 'refuse') continue
    const choice = graph.choices.get(gate.choice_id)
    const from = choice ? graph.nodes.get(choice.from_node_id) : null
    push(
      'refusal',
      `${from?.slug ?? '?'}#d${choice?.digit ?? '?'}`,
      'refusal',
      gate.fail_audio_path ? 'recorded' : 'missing',
      gate.fail_audio_path,
      gate.fail_audio_duration_ms,
      gate.fail_narration ?? '',
    )
  }

  return rows.join('\n')
}

/** F6.3 — full backup, so the whole thing round-trips. */
export function storyJson(graph: StoryGraph): string {
  return JSON.stringify(
    {
      // Bumped when the cast, dialogue and fight tables were added: a v1 file
      // has no characters key at all, which an importer has to be able to tell
      // apart from a v2 file whose cast happens to be empty.
      version: 2,
      exportedAt: null, // stamped by the caller; kept out so the payload is deterministic
      story: graph.story,
      nodes: [...graph.nodes.values()],
      choices: [...graph.choices.values()],
      stateVars: [...graph.stateVars.values()],
      effects: [...graph.effects.values()],
      gates: [...graph.gates.values()],
      characters: [...graph.characters.values()],
      dialogue: [...graph.dialogue.values()],
      fights: [...graph.fights.values()],
      fightMoves: [...graph.fightMoves.values()],
      fightRounds: [...graph.fightRounds.values()],
      fightOutcomes: [...graph.fightOutcomes.values()],
    },
    null,
    2,
  )
}

/**
 * F6.5 — a printable script for VO talent, one room per section.
 *
 * `onlyActor` narrows it to the rooms one voice actor appears in. Their lines
 * are marked with a caret in the left margin and everyone else's are left plain
 * as cues, because a script with the other parts stripped out is unreadable —
 * you cannot time a line you can't see the setup for.
 */
export function printableScript(graph: StoryGraph, onlyActor?: string): string {
  const wanted = onlyActor?.trim().toLowerCase()
  const speaksHere = (nodeId: string) =>
    !wanted ||
    linesFor(graph, nodeId).some((l) => {
      const c = l.character_id ? graph.characters.get(l.character_id) : null
      return (c?.voice_actor ?? '').trim().toLowerCase() === wanted
    })

  const out: string[] = [
    graph.story.title + (onlyActor ? ` — ${onlyActor}'s script` : ''),
    '='.repeat(60),
    '',
  ]
  if (onlyActor) {
    out.push('Your lines are marked with >. Everything else is a cue — read for timing,')
    out.push('not aloud. A room is recorded as one file, so the whole room gets booked')
    out.push('even when only one line in it is yours.')
    out.push('')
  }

  const nodes = [...graph.nodes.values()]
    .filter((n) => speaksHere(n.id))
    .sort((a, b) => a.slug.localeCompare(b.slug))

  for (const n of nodes) {
    out.push(`## ${n.slug}${n.title ? ` — ${n.title}` : ''}`)
    if (n.status === 'approved') out.push('(approved)')
    else if (n.audio_path) out.push('(recorded, not yet approved)')
    out.push('')

    const lines = linesFor(graph, n.id)
    if (lines.length === 0) {
      out.push(n.narration || '(nothing written yet)')
    } else {
      for (const line of lines) {
        const character = line.character_id ? graph.characters.get(line.character_id) : null
        const mine =
          wanted !== undefined &&
          (character?.voice_actor ?? '').trim().toLowerCase() === wanted
        const who = character ? `${character.name}: ` : ''
        out.push(`${mine ? '>' : ' '} ${who}${line.text}`)
      }
    }

    // A fight's rounds are script too, and they are the lines most likely to be
    // missed — they live on the fight, not in the room's narration.
    const fight = buildFightView(graph, n.id)
    if (fight) {
      out.push('')
      out.push(`   [fight: ${fight.fight.opponent_name}]`)
      fight.table.forEach(({ round, cells }, i) => {
        out.push(`   ${i + 1}. ${round.narration || round.opponent_move}`)
        // Every digit, not just the "right" one — a round where all three lead
        // to the same room has no right answer, and a script that printed one
        // would be describing a fight that doesn't exist.
        for (const cell of cells) {
          out.push(`        ${cell.digit} ${cell.move.slug} → ${cell.where}`)
        }
      })
    }

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

/** The cast, and what each of them still owes. Booked against, not read aloud. */
export function castManifestCsv(graph: StoryGraph): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const lineCount = new Map<string, number>()
  for (const line of graph.dialogue.values()) {
    if (!line.character_id) continue
    lineCount.set(line.character_id, (lineCount.get(line.character_id) ?? 0) + 1)
  }

  const outstanding = new Map(workloads(graph).map((w) => [w.actor ?? '', w.unrecordedSlugs.length]))

  const rows = [
    ['slug', 'name', 'playable', 'voice_actor', 'lines', 'rooms_left_to_record'].join(','),
  ]
  for (const c of castList(graph)) {
    rows.push(
      [
        esc(c.slug),
        esc(c.name),
        c.is_playable ? 'yes' : 'no',
        esc(c.voice_actor ?? ''),
        String(lineCount.get(c.id) ?? 0),
        String(outstanding.get(c.voice_actor?.trim() ?? '') ?? 0),
      ].join(','),
    )
  }
  return rows.join('\n')
}
