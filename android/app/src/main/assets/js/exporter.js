var JackieExport = function(exports) {
  "use strict";
  const index = (rows) => new Map((rows ?? []).map((r) => [r.id, r]));
  function graphFromRows(rows) {
    return {
      story: rows.story,
      nodes: index(rows.nodes),
      choices: index(rows.choices),
      stateVars: index(rows.state_vars),
      effects: index(rows.effects),
      gates: index(rows.gates),
      characters: index(rows.characters),
      dialogue: index(rows.dialogue_lines),
      fights: index(rows.fights),
      fightMoves: index(rows.fight_moves),
      fightRounds: index(rows.fight_rounds),
      fightOutcomes: index(rows.fight_round_outcomes)
    };
  }
  const fightEdgeId = (fightId, outcome) => `fight:${fightId}:${outcome}`;
  const fightMoveEdgeId = (outcomeId) => `fightmove:${outcomeId}`;
  const divertEdgeId = (gateId) => `divert:${gateId}`;
  function graphEdges(graph) {
    const edges = [];
    for (const choice of graph.choices.values()) {
      edges.push({
        id: choice.id,
        kind: "choice",
        from_node_id: choice.from_node_id,
        to_node_id: choice.to_node_id,
        digit: choice.digit,
        label: choice.label,
        sort_order: choice.sort_order,
        choice
      });
    }
    for (const fight of graph.fights.values()) {
      if (!graph.nodes.has(fight.node_id)) continue;
      edges.push({
        id: fightEdgeId(fight.id, "win"),
        kind: "fight-win",
        from_node_id: fight.node_id,
        to_node_id: fight.win_node_id,
        digit: null,
        label: `beat ${fight.opponent_name}`,
        // Sorted after every keypad digit so a fight room's win/lose never jump
        // ahead of a choice in any digit-ordered list.
        sort_order: 100,
        choice: null
      });
      edges.push({
        id: fightEdgeId(fight.id, "lose"),
        kind: "fight-lose",
        from_node_id: fight.node_id,
        to_node_id: fight.lose_node_id,
        digit: null,
        label: `lose to ${fight.opponent_name}`,
        sort_order: 101,
        choice: null
      });
    }
    for (const outcome of graph.fightOutcomes.values()) {
      const fight = graph.fights.get(outcome.fight_id);
      if (!fight || !graph.nodes.has(fight.node_id)) continue;
      const move = graph.fightMoves.get(outcome.move_id);
      edges.push({
        id: fightMoveEdgeId(outcome.id),
        kind: "fight-move",
        from_node_id: fight.node_id,
        to_node_id: outcome.to_node_id,
        digit: null,
        label: move ? `answer with ${move.slug}` : "answer",
        sort_order: 102,
        choice: null
      });
    }
    for (const gate of graph.gates.values()) {
      if (gate.fail_behavior !== "divert") continue;
      const choice = graph.choices.get(gate.choice_id);
      if (!choice || !graph.nodes.has(choice.from_node_id)) continue;
      edges.push({
        id: divertEdgeId(gate.id),
        kind: "divert",
        from_node_id: choice.from_node_id,
        to_node_id: gate.fail_node_id,
        digit: null,
        label: choice.label ? `${choice.label}, without` : "the other way",
        // Beside the door it forks from, and after it: a digit-ordered list must
        // still lead with the key the caller presses.
        sort_order: choice.sort_order + 0.5,
        choice: null
      });
    }
    return edges;
  }
  function linesOf(graph, owner) {
    return [...graph.dialogue.values()].filter(
      (l) => "nodeId" in owner ? l.node_id === owner.nodeId : l.choice_id === owner.choiceId
    ).sort((a, b) => a.sort_order - b.sort_order);
  }
  function linesFor(graph, nodeId) {
    return linesOf(graph, { nodeId });
  }
  function splitsByLine(graph, owner) {
    return linesOf(graph, owner).some((l) => l.audio_path);
  }
  function reactionPlaybackFor(graph, choiceId) {
    const choice = graph.choices.get(choiceId);
    if (!choice) return [];
    if (!splitsByLine(graph, { choiceId })) {
      return choice.audio_path || choice.reaction_narration?.trim() ? [
        {
          id: choice.id,
          audioPath: choice.audio_path,
          say: choice.reaction_narration ?? "",
          speaker: null
        }
      ] : [];
    }
    return linesOf(graph, { choiceId }).map((line) => partOf(graph, line));
  }
  const partOf = (graph, line) => ({
    id: line.id,
    audioPath: line.audio_path,
    say: line.text,
    speaker: line.character_id ? graph.characters.get(line.character_id)?.name ?? null : null
  });
  function playbackFor(graph, nodeId) {
    const node = graph.nodes.get(nodeId);
    if (!node) return [];
    if (!splitsByLine(graph, { nodeId })) {
      return [{ id: node.id, audioPath: node.audio_path, say: node.narration, speaker: null }];
    }
    return linesFor(graph, nodeId).map((line) => partOf(graph, line));
  }
  function byCode(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const MAX_FIGHT_MOVES = 9;
  const normaliseMove = (s) => (s ?? "").trim().toLowerCase();
  const outcomeKey = (roundId, moveId) => `${roundId}:${moveId}`;
  function fightFor(graph, nodeId) {
    for (const f of graph.fights.values()) if (f.node_id === nodeId) return f;
    return null;
  }
  function movesOf$1(graph, fightId) {
    return [...graph.fightMoves.values()].filter((m) => m.fight_id === fightId).sort((a, b) => a.sort_order - b.sort_order || byCode(a.slug, b.slug));
  }
  function roundsOf(graph, fightId) {
    return [...graph.fightRounds.values()].filter((r) => r.fight_id === fightId).sort((a, b) => a.sort_order - b.sort_order);
  }
  function outcomesOf(graph, fightId) {
    const out = /* @__PURE__ */ new Map();
    for (const o of graph.fightOutcomes.values()) {
      if (o.fight_id === fightId) out.set(outcomeKey(o.round_id, o.move_id), o);
    }
    return out;
  }
  function countersFor(moves, round) {
    const wanted = normaliseMove(round.opponent_move);
    if (!wanted) return [];
    return moves.filter((m) => normaliseMove(m.beats) === wanted);
  }
  function resolveMove(view, roundIndex, moveId) {
    const round = view.rounds[roundIndex];
    if (!round) return { nodeId: null, via: "lose", nextRound: null };
    const named = view.outcomes.get(outcomeKey(round.id, moveId));
    if (named) return { nodeId: named.to_node_id, via: "named", nextRound: null };
    const counters = countersFor(view.moves, round);
    if (counters.some((m) => m.id === moveId)) {
      const next = roundIndex + 1;
      if (next < view.rounds.length) return { nodeId: null, via: "advance", nextRound: next };
      return { nodeId: view.fight.win_node_id, via: "win", nextRound: null };
    }
    return { nodeId: view.fight.lose_node_id, via: "lose", nextRound: null };
  }
  function resolveMiss(view) {
    return view.fight.lose_node_id;
  }
  function buildFightView(graph, nodeId) {
    const fight = fightFor(graph, nodeId);
    if (!fight) return null;
    const moves = movesOf$1(graph, fight.id);
    const rounds = roundsOf(graph, fight.id);
    const outcomes = outcomesOf(graph, fight.id);
    const titleOf = (id) => {
      if (!id) return null;
      const n = graph.nodes.get(id);
      return n ? n.title || n.slug : null;
    };
    const core = { fight, moves, rounds, outcomes };
    const table = rounds.map((round, i) => ({
      round,
      cells: moves.slice(0, MAX_FIGHT_MOVES).map((move, m) => {
        const outcome = resolveMove(core, i, move.id);
        const advancing = outcome.via === "advance" && outcome.nextRound !== null;
        return {
          digit: String(m + 1),
          move,
          via: outcome.via,
          where: advancing ? `round ${(outcome.nextRound ?? 0) + 1}` : titleOf(outcome.nodeId) ?? "nowhere yet",
          wired: advancing || Boolean(outcome.nodeId)
        };
      })
    }));
    return {
      ...core,
      table,
      winTitle: titleOf(fight.win_node_id),
      loseTitle: titleOf(fight.lose_node_id),
      problems: fightProblems(core)
    };
  }
  function fightProblems(view) {
    const { fight, moves, rounds } = view;
    const problems = [];
    if (moves.length === 0) problems.push("No moves yet — the caller has nothing to press.");
    if (rounds.length === 0) problems.push("No rounds yet — the fight ends before it begins.");
    if (moves.length > MAX_FIGHT_MOVES) {
      problems.push(
        `${moves.length} moves, but the keypad only reaches ${MAX_FIGHT_MOVES} — the rest can never be pressed.`
      );
    }
    const playable = moves.slice(0, MAX_FIGHT_MOVES);
    let usesWin = false;
    let usesLose = false;
    rounds.forEach((round, i) => {
      let anyForward = false;
      let named = 0;
      playable.forEach((move, m) => {
        const outcome = resolveMove(view, i, move.id);
        if (outcome.via === "named") named += 1;
        if (outcome.via === "win") usesWin = true;
        if (outcome.via === "lose") usesLose = true;
        if (outcome.via === "advance" || outcome.nodeId) {
          anyForward = true;
        } else if (outcome.via === "named") {
          problems.push(`Round ${i + 1}: pressing ${m + 1} (${move.slug}) leads nowhere yet.`);
        }
      });
      if (playable.length > 0 && !anyForward) {
        problems.push(`Round ${i + 1}: nothing gets past this — every answer stops the fight.`);
      }
      if (!round.opponent_move.trim() && named < playable.length) {
        problems.push(`Round ${i + 1} doesn't say what the opponent does.`);
      }
    });
    if (usesWin && !fight.win_node_id) problems.push("Nowhere to go after winning.");
    if (!fight.lose_node_id) {
      problems.push(
        usesLose ? "Nowhere to go after losing — a wrong answer would leave the caller in limbo." : "Nowhere to go after losing — a digit no move uses, or silence, would leave the caller in limbo."
      );
    }
    return problems;
  }
  function fightsByNode(graph) {
    const out = /* @__PURE__ */ new Map();
    for (const f of graph.fights.values()) out.set(f.node_id, f);
    return out;
  }
  const INV_VAR = "inv";
  function counterVar(slug) {
    return `c_${slug}`;
  }
  function delimited(slug) {
    return `|${slug}|`;
  }
  function grantLiquid(slug) {
    return `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}{% if cur contains "${delimited(slug)}" %}{{ cur }}{% else %}{{ cur }}${slug}|{% endif %}`;
  }
  function revokeLiquid(slug) {
    return `{{ flow.variables.${INV_VAR} | replace: "${delimited(slug)}", "|" }}`;
  }
  function counterAddLiquid(slug, amount) {
    const op = amount < 0 ? "minus" : "plus";
    return `{{ flow.variables.${counterVar(slug)} | default: 0 | ${op}: ${Math.abs(amount)} }}`;
  }
  function counterSetLiquid(_slug, amount) {
    return String(amount);
  }
  function compile(e) {
    switch (e.op) {
      case "has":
        return `inv contains "${delimited(e.var)}"`;
      case "lacks":
        return `inv contains "${delimited(e.var)}" == false`;
      case "gte":
        return `${localCounter(e.var)} >= ${e.value}`;
      case "lte":
        return `${localCounter(e.var)} <= ${e.value}`;
      case "eq":
        return `${localCounter(e.var)} == ${e.value}`;
      case "and":
        return e.args.length === 0 ? "true" : e.args.map(compile).join(" and ");
      case "or":
        return e.args.length === 0 ? "false" : e.args.map(compile).join(" or ");
      case "not": {
        const inner = e.args[0];
        if (inner.op === "has") return compile({ op: "lacks", var: inner.var });
        if (inner.op === "lacks") return compile({ op: "has", var: inner.var });
        if (inner.op === "gte") return `${localCounter(inner.var)} < ${inner.value}`;
        if (inner.op === "lte") return `${localCounter(inner.var)} > ${inner.value}`;
        if (inner.op === "eq") return `${localCounter(inner.var)} != ${inner.value}`;
        return "true";
      }
      default:
        return "true";
    }
  }
  function localCounter(slug) {
    return `v_${slug}`;
  }
  function countersUsed(e) {
    switch (e.op) {
      case "gte":
      case "lte":
      case "eq":
        return [e.var];
      case "and":
      case "or":
        return e.args.flatMap(countersUsed);
      case "not":
        return countersUsed(e.args[0]);
      default:
        return [];
    }
  }
  function gateAssignmentLiquid(expression) {
    const counters = [...new Set(countersUsed(expression))];
    const preamble = `{% assign inv = flow.variables.${INV_VAR} | default: "|" %}` + counters.map((c) => `{% assign ${localCounter(c)} = flow.variables.${counterVar(c)} | default: 0 %}`).join("");
    return `${preamble}{% if ${compile(expression)} %}pass{% else %}fail{% endif %}`;
  }
  function gateVarName(slug, digit) {
    return `gate_${slug}_d${digitToken$1(digit)}`;
  }
  function consumeLiquid(slugs) {
    if (slugs.length === 0) return `{{ flow.variables.${INV_VAR} | default: "|" }}`;
    const first = `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}`;
    const steps = slugs.map(
      (slug) => `{% if cur contains "${delimited(slug)}" and spent == false %}{% assign cur = cur | replace: "${delimited(slug)}", "|" %}{% assign spent = true %}{% endif %}`
    ).join("");
    return `${first}{% assign spent = false %}${steps}{{ cur }}`;
  }
  function consumeAllLiquid(slugs) {
    if (slugs.length === 0) return `{{ flow.variables.${INV_VAR} | default: "|" }}`;
    const replaces = slugs.map((slug) => ` | replace: "${delimited(slug)}", "|"`).join("");
    return `{{ flow.variables.${INV_VAR} | default: "|"${replaces} }}`;
  }
  function digitToken$1(digit) {
    if (digit === "*") return "star";
    if (digit === "#") return "hash";
    return digit;
  }
  function doorsByDigit(graph, nodeId) {
    const out = /* @__PURE__ */ new Map();
    const doors = [...graph.choices.values()].filter((c) => c.from_node_id === nodeId).sort((a, b) => a.sort_order - b.sort_order || byCode(a.id, b.id));
    for (const door of doors) {
      const list = out.get(door.digit) ?? [];
      list.push(door);
      out.set(door.digit, list);
    }
    return out;
  }
  function keyConflicts(graph, nodeId) {
    const out = [];
    for (const [digit, doors] of doorsByDigit(graph, nodeId)) {
      if (doors.length > 1) out.push({ digit, choiceIds: doors.map((d) => d.id) });
    }
    return out.sort((a, b) => byCode(a.digit, b.digit));
  }
  function clipFor(item, move) {
    const say = (move === "gain" ? item.gain_narration : item.spend_narration)?.trim() ?? "";
    const audioPath = move === "gain" ? item.gain_audio_path : item.spend_audio_path;
    if (!say && !audioPath) return null;
    return { id: `${item.id}:${move}`, audioPath, say, speaker: null };
  }
  function movesOf(graph, effects) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const effect of effects) {
      const item = effect.state_var_id ? graph.stateVars.get(effect.state_var_id) : [...graph.stateVars.values()].find((v) => v.slug === effect.varSlug);
      if (!item) continue;
      const move = effect.operation === "grant" || effect.operation === "add" ? "gain" : effect.operation === "revoke" ? "spend" : null;
      if (!move) continue;
      const key = `${item.id}:${move}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([item, move]);
    }
    return out;
  }
  function clipsFor(graph, effects) {
    return movesOf(graph, effects).map(([item, move]) => clipFor(item, move)).filter((p) => p !== null);
  }
  function spendClips(graph, slugs) {
    return slugs.map((slug) => [...graph.stateVars.values()].find((v) => v.slug === slug)).map((item) => item ? clipFor(item, "spend") : null).filter((p) => p !== null);
  }
  function emitFight(ctx) {
    const {
      graph,
      node,
      slug,
      outgoing,
      fight,
      moves,
      rounds,
      outcomes,
      audioBaseUrl,
      widgets,
      warnings,
      entryName,
      fightOutcome,
      roundName,
      roundEntry
    } = ctx;
    const view = { fight, moves, rounds, outcomes };
    const missNext = fightOutcome(resolveMiss(view), node);
    rounds.forEach((round, i) => {
      if (round.audio_path) {
        widgets.push({
          name: roundName(slug, i, "play"),
          type: "say-play",
          nodeId: node.id,
          note: `Round ${i + 1}: ${fight.opponent_name} throws ${round.opponent_move || "(nothing set)"}.`,
          playUrl: `${audioBaseUrl}${round.audio_path}`,
          transitions: [{ event: "audioComplete", next: roundName(slug, i, "gather") }]
        });
      } else {
        warnings.push(
          `${slug} round ${i + 1} has no recording, so the caller hears nothing before answering it.`
        );
      }
      const roundTransitions = [];
      const legend = [];
      moves.slice(0, MAX_FIGHT_MOVES).forEach((move, m) => {
        const outcome = resolveMove(view, i, move.id);
        const next = outcome.via === "advance" && outcome.nextRound !== null ? roundEntry(slug, rounds, outcome.nextRound) : fightOutcome(outcome.nodeId, node);
        roundTransitions.push({
          event: "match",
          condition: `Digits equals ${m + 1}`,
          match: { type: "equal_to", value: String(m + 1) },
          next
        });
        legend.push(`${m + 1}=${move.slug}`);
      });
      roundTransitions.push({ event: "noMatch", next: missNext });
      widgets.push({
        name: roundName(slug, i, "gather"),
        type: "gather-input-on-call",
        nodeId: node.id,
        note: legend.length > 0 ? `${legend.join(", ")}. Any other digit, and silence, takes the losing route.` : "This round has no moves — every answer takes the losing route.",
        properties: gatherProperties(node.timeout_seconds),
        transitions: [
          { event: "keypress", next: `${slug}_r${i + 1}_keys` },
          { event: "speech", next: `${slug}_r${i + 1}_keys` },
          // Silence is not a wrong answer. Callers hesitate, mishear, or are
          // still working out which digit is which, so the round repeats a
          // few times before the fight is called — through a counter, because
          // routing timeout straight back at the round would run one widget
          // in a loop and Studio ends an execution after ten consecutive runs
          // of the same widget (§6.0).
          { event: "timeout", next: `${slug}_r${i + 1}_waited` }
        ]
      });
      widgets.push({
        name: `${slug}_r${i + 1}_keys`,
        type: "split-based-on",
        nodeId: node.id,
        note: "Which move the caller answered with.",
        splitOn: `{{widgets.${roundName(slug, i, "gather")}.Digits}}`,
        transitions: roundTransitions
      });
      const silenceVar = `${slug}_r${i + 1}_silence`;
      widgets.push({
        name: `${slug}_r${i + 1}_waited`,
        type: "set-variables",
        nodeId: node.id,
        note: "The caller said nothing. Count it.",
        variables: [
          {
            key: silenceVar,
            value: `{{ flow.variables.${silenceVar} | default: 0 | plus: 1 }}`
          }
        ],
        transitions: [{ event: "next", next: `${slug}_r${i + 1}_patience` }]
      });
      widgets.push({
        name: `${slug}_r${i + 1}_patience`,
        type: "split-based-on",
        nodeId: node.id,
        note: `Repeat the round up to ${fight.silence_patience} times, then the fight is called.`,
        splitOn: `{{flow.variables.${silenceVar}}}`,
        transitions: [
          {
            event: "match",
            condition: `Less than ${fight.silence_patience}`,
            match: { type: "less_than", value: String(fight.silence_patience) },
            next: roundEntry(slug, rounds, i)
          },
          { event: "noMatch", next: missNext }
        ]
      });
    });
    const winner = fight.win_node_id ? graph.nodes.get(fight.win_node_id) : null;
    widgets.push({
      name: `${slug}_reset`,
      type: "set-variables",
      nodeId: node.id,
      note: rounds.length > 0 ? "Clear the silence counters, so re-entering this fight starts fresh." : "This fight has no rounds, so it is walked straight through.",
      variables: rounds.map((_, i) => ({ key: `${slug}_r${i + 1}_silence`, value: "0" })),
      transitions: [
        {
          event: "next",
          next: rounds.length > 0 ? roundEntry(slug, rounds, 0) : winner ? entryName(winner) : null
        }
      ]
    });
    for (const problem of fightProblems(view)) {
      warnings.push(`${slug}: ${problem}`);
    }
    if (outgoing.length > 0) {
      warnings.push(
        `${slug} is a fight but also has ${outgoing.length} exit(s). A fight decides where the caller goes, so those doors are not exported.`
      );
    }
  }
  function consumePlan(expression, isConsumable) {
    const slugs = [];
    collect(expression, isConsumable, slugs);
    return {
      mode: expression?.op === "or" ? "first" : "all",
      slugs: [...new Set(slugs)]
    };
  }
  function collect(expression, isConsumable, out) {
    if (!expression) return;
    if (expression.op === "has") {
      if (isConsumable(expression.var)) out.push(expression.var);
      return;
    }
    if (expression.op === "and" || expression.op === "or") {
      for (const arg of expression.args) collect(arg, isConsumable, out);
    }
  }
  function emitDoor(ctx) {
    const {
      graph,
      node,
      slug,
      choice,
      dkey,
      audioBaseUrl,
      widgets,
      warnings,
      gateByChoice,
      gateWidget,
      effectsFor,
      variablesFor,
      entryName,
      wname: wname2
    } = ctx;
    const gate = gateByChoice.get(choice.id);
    const fx = effectsFor((e) => e.choice_id === choice.id);
    const target = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null;
    let dest = target ? entryName(target) : null;
    if (!target) {
      warnings.push(
        `${slug} digit ${choice.digit} ("${choice.label}") is an unwritten branch — it has nowhere to go and is exported as a repeat.`
      );
      dest = wname2(slug, "gather");
    }
    const reactParts = reactionPlaybackFor(graph, choice.id);
    const reactRecorded = reactParts.filter((p) => p.audioPath);
    const reactName = (i) => `${slug}_d${dkey}_react${i === 0 ? "" : `_line${i + 1}`}`;
    const forks = gate?.fail_behavior === "divert";
    const wrapReaction = (next) => {
      let at = next;
      for (let i = reactRecorded.length - 1; i >= 0; i--) {
        const part = reactRecorded[i];
        widgets.push({
          name: reactName(i),
          type: "say-play",
          nodeId: node.id,
          note: `Reaction to pressing ${choice.digit}.${part.speaker ? ` — ${part.speaker}` : ""}`,
          playUrl: `${audioBaseUrl}${part.audioPath}`,
          transitions: [{ event: "audioComplete", next: at }]
        });
        at = reactName(i);
      }
      return at;
    };
    const wrapClips = (clips, kind, next) => {
      let at = next;
      for (let i = clips.length - 1; i >= 0; i--) {
        const clip = clips[i];
        if (!clip.audioPath) {
          warnings.push(
            `${slug} digit ${choice.digit}: "${clip.say.slice(0, 40)}" is written for an item changing hands but has no recording, so the caller hears nothing at that moment.`
          );
          continue;
        }
        const name = `${slug}_d${dkey}_${kind}${i === 0 ? "" : i + 1}`;
        widgets.push({
          name,
          type: "say-play",
          nodeId: node.id,
          note: `Heard as an item changes hands on digit ${choice.digit}.`,
          playUrl: `${audioBaseUrl}${clip.audioPath}`,
          transitions: [{ event: "audioComplete", next: at }]
        });
        at = name;
      }
      return at;
    };
    if (!forks) dest = wrapReaction(dest);
    const reactMissing = reactParts.length - reactRecorded.length;
    if (reactMissing > 0) {
      warnings.push(
        reactParts.length === 1 ? `${slug} digit ${choice.digit} has a reaction written ("${reactParts[0].say.trim().slice(0, 40)}…") with no recording, so the caller hears nothing between pressing and arriving.` : `${slug} digit ${choice.digit}'s reaction plays line by line and ${reactMissing} of its ${reactParts.length} lines have no take — those lines are silent.`
      );
    }
    if (gate?.consume_on_pass) {
      const plan = consumePlan(
        gate.expression,
        (s) => Boolean([...graph.stateVars.values()].find((v) => v.slug === s)?.is_consumable)
      );
      if (plan.slugs.length > 0) {
        dest = wrapClips(spendClips(graph, plan.slugs), "spent", dest);
        const spendName = `${slug}_d${dkey}_spend`;
        widgets.push({
          name: spendName,
          type: "set-variables",
          nodeId: node.id,
          note: plan.mode === "first" ? `Spend whichever of ${plan.slugs.join(" / ")} opened this — only the one.` : `Spend ${plan.slugs.join(", ")}, which this door required.`,
          variables: [
            {
              key: INV_VAR,
              value: plan.mode === "first" ? consumeLiquid(plan.slugs) : consumeAllLiquid(plan.slugs)
            }
          ],
          transitions: [{ event: "next", next: dest }]
        });
        dest = spendName;
      } else {
        warnings.push(
          `${slug} digit ${choice.digit} is set to use up what opened it, but none of the items it requires are marked as used up — so nothing is spent.`
        );
      }
    }
    if (fx.length > 0) {
      dest = wrapClips(clipsFor(graph, fx), "item", dest);
      const fxName = `${slug}_d${dkey}_fx`;
      widgets.push({
        name: fxName,
        type: "set-variables",
        nodeId: node.id,
        note: `Effects for pressing ${choice.digit}.`,
        variables: variablesFor(fx),
        transitions: [{ event: "next", next: dest }]
      });
      dest = fxName;
    }
    if (gate && gate.fail_behavior !== "hide") {
      const splitName = `${slug}_d${dkey}_gate`;
      const refuseName = `${slug}_d${dkey}_refuse`;
      const failNext = gate.fail_behavior === "divert" ? gate.fail_node_id ? entryName(graph.nodes.get(gate.fail_node_id) ?? node) : wname2(slug, "gather") : gate.fail_audio_path ? refuseName : wname2(slug, "gather");
      widgets.push({
        name: splitName,
        type: "split-based-on",
        nodeId: node.id,
        note: `Gate on digit ${choice.digit}; the boolean was computed in ${gateWidget}.`,
        splitOn: `{{flow.variables.${gateVarName(slug, choice.digit)}}}`,
        transitions: [
          {
            event: "match",
            condition: "Equal To pass",
            match: { type: "equal_to", value: "pass" },
            next: dest
          },
          { event: "noMatch", next: failNext }
        ]
      });
      if (gate.fail_behavior === "refuse") {
        if (gate.fail_audio_path) {
          widgets.push({
            name: refuseName,
            type: "say-play",
            nodeId: node.id,
            note: `Refusal. Returns to the GATHER, not the play widget, so the caller doesn't re-hear the whole scene. Route the ${PATIENCE_VALVE_AT}th attempt to an escape.`,
            playUrl: `${audioBaseUrl}${gate.fail_audio_path}`,
            transitions: [{ event: "audioComplete", next: wname2(slug, "gather") }]
          });
        } else {
          warnings.push(
            `${slug} digit ${choice.digit} refuses the caller with no recording, so they are sent back to the choices without being told why.`
          );
        }
      }
      dest = splitName;
      if (forks) dest = wrapReaction(dest);
    }
    return dest;
  }
  const RET_VAR = "ret";
  const INV_START = "inv_start";
  const INV_NONE = "inv_none";
  const INV_INTRO = "inv_intro";
  const INV_RETURN = "inv_return";
  const invRetName = (slug) => `inv_ret_${slug}`;
  const invItemCheck = (slug) => `inv_${slug}_check`;
  const invItemPlay = (slug) => `inv_${slug}_play`;
  function planInventory(graph) {
    const key = graph.story.inventory_key;
    if (!key) return null;
    const items = [...graph.stateVars.values()].filter((v) => v.kind === "item").sort((a, b) => byCode(a.slug, b.slug));
    return {
      key,
      spoken: items.filter((v) => v.audio_path),
      silent: items.filter((v) => !v.audio_path),
      introRecorded: Boolean(graph.story.inventory_intro_audio_path),
      emptyRecorded: Boolean(graph.story.inventory_empty_audio_path)
    };
  }
  function emptyHandedCondition() {
    return `{{ flow.variables.${INV_VAR} | default: "|" }}`;
  }
  function keyCollisions(graph) {
    const key = graph.story.inventory_key;
    if (!key) return [];
    const out = [];
    for (const choice of graph.choices.values()) {
      if (choice.digit !== key) continue;
      const room = graph.nodes.get(choice.from_node_id);
      if (room) out.push(room.slug);
    }
    return [...new Set(out)].sort();
  }
  const WIDGET_LIMIT = 1e3;
  const STEP_LIMIT = 1e3;
  const PATIENCE_VALVE_AT = 8;
  function gatherProperties(timeoutSeconds) {
    return {
      say: "",
      loop: 1,
      number_of_digits: 1,
      stop_gather: true,
      timeout: timeoutSeconds,
      gather_language: "en"
    };
  }
  const wname = (slug, suffix) => `${slug}_${suffix}`;
  function digitToken(digit) {
    if (digit === "*") return "star";
    if (digit === "#") return "hash";
    return digit;
  }
  function compileStory(graph, audioBaseUrl) {
    const widgets = [];
    const warnings = [];
    const slugOf = (id) => graph.stateVars.get(id)?.slug ?? "";
    const nodes = [...graph.nodes.values()];
    const gateByChoice = new Map([...graph.gates.values()].map((g) => [g.choice_id, g]));
    const fights = fightsByNode(graph);
    const choicesFrom = (nodeId) => [...graph.choices.values()].filter((c) => c.from_node_id === nodeId).sort((a, b) => a.sort_order - b.sort_order);
    const effectsFor = (predicate) => [...graph.effects.values()].filter(predicate).sort((a, b) => a.sort_order - b.sort_order);
    const variablesFor = (effects) => {
      const vars = [];
      const invEffects = effects.filter((e) => graph.stateVars.get(e.state_var_id)?.kind !== "counter");
      if (invEffects.length === 1) {
        const slug = slugOf(invEffects[0].state_var_id);
        vars.push({
          key: INV_VAR,
          value: invEffects[0].operation === "revoke" ? revokeLiquid(slug) : grantLiquid(slug)
        });
      } else if (invEffects.length > 1) {
        vars.push({ key: INV_VAR, value: chainedInventoryLiquid(invEffects.map((e) => ({
          slug: slugOf(e.state_var_id),
          revoke: e.operation === "revoke"
        }))) });
      }
      for (const e of effects) {
        const v = graph.stateVars.get(e.state_var_id);
        if (v?.kind !== "counter") continue;
        const slug = v.slug;
        vars.push({
          key: counterVar(slug),
          value: e.operation === "set" ? counterSetLiquid(slug, e.amount ?? 0) : counterAddLiquid(slug, e.operation === "revoke" ? -(e.amount ?? 1) : e.amount ?? 1)
        });
      }
      return vars;
    };
    const inventory = planInventory(graph);
    const collidingRooms = new Set(keyCollisions(graph));
    const returnsTo = [];
    const playName = (slug) => wname(slug, "play");
    const roundName = (slug, index2, part) => `${slug}_r${index2 + 1}_${part}`;
    const roundEntry = (slug, rounds, i) => rounds[i]?.audio_path ? roundName(slug, i, "play") : roundName(slug, i, "gather");
    const afterAudioName = (n) => {
      if (n.node_type === "ending") return null;
      if (fights.has(n.id)) return `${n.slug}_reset`;
      return wname(n.slug, "gather");
    };
    const baseAudioName = (n) => playbackFor(graph, n.id).some((p) => p.audioPath) ? playName(n.slug) : afterAudioName(n);
    const replayName = (n) => baseAudioName(n);
    const entryName = (n) => {
      if (effectsFor((e) => e.node_id === n.id).length > 0) return wname(n.slug, "fx");
      if (choicesFrom(n.id).some((c) => gateByChoice.has(c.id))) return wname(n.slug, "gates");
      return replayName(n);
    };
    const fightOutcome = (targetId, fallback) => {
      const target = targetId ? graph.nodes.get(targetId) : null;
      return entryName(target ?? fallback);
    };
    for (const node of nodes) {
      const slug = node.slug;
      const outgoing = choicesFrom(node.id);
      const gated = outgoing.filter((c) => gateByChoice.has(c.id));
      const fight = fights.get(node.id);
      const rounds = fight ? roundsOf(graph, fight.id) : [];
      const moves = fight ? movesOf$1(graph, fight.id) : [];
      const outcomes = fight ? outcomesOf(graph, fight.id) : /* @__PURE__ */ new Map();
      const arrival = effectsFor((e) => e.node_id === node.id);
      if (arrival.length > 0) {
        widgets.push({
          name: wname(slug, "fx"),
          type: "set-variables",
          nodeId: node.id,
          note: "Arrival effects — fire before the room is described.",
          variables: variablesFor(arrival),
          transitions: [{ event: "next", next: null }]
          // filled in below
        });
      }
      const wrapArrivalClips = (next) => {
        let at = next;
        const clips = clipsFor(graph, arrival);
        for (let i = clips.length - 1; i >= 0; i--) {
          const clip = clips[i];
          if (!clip.audioPath) {
            warnings.push(
              `${slug}: "${clip.say.slice(0, 40)}" is written for an item changing hands on arrival but has no recording, so the caller hears nothing at that moment.`
            );
            continue;
          }
          const name = `${slug}_item${i === 0 ? "" : i + 1}`;
          widgets.push({
            name,
            type: "say-play",
            nodeId: node.id,
            note: "Heard as an item changes hands on arrival.",
            playUrl: `${audioBaseUrl}${clip.audioPath}`,
            transitions: [{ event: "audioComplete", next: at }]
          });
          at = name;
        }
        return at;
      };
      let gateWidget = null;
      if (gated.length > 0) {
        gateWidget = wname(slug, "gates");
        widgets.push({
          name: gateWidget,
          type: "set-variables",
          nodeId: node.id,
          note: `All ${gated.length} gate(s) on this room, batched into one widget (§6.3).`,
          variables: gated.map((c) => {
            const gate = gateByChoice.get(c.id);
            return { key: gateVarName(slug, c.digit), value: gateAssignmentLiquid(gate.expression) };
          }),
          transitions: [{ event: "next", next: replayName(node) }]
        });
        if (arrival.length > 0) {
          widgets.find((w) => w.name === wname(slug, "fx")).transitions = [
            { event: "next", next: wrapArrivalClips(gateWidget) }
          ];
        }
      } else if (arrival.length > 0) {
        widgets.find((w) => w.name === wname(slug, "fx")).transitions = [
          { event: "next", next: wrapArrivalClips(replayName(node)) }
        ];
      }
      const hideGated = outgoing.filter(
        (c) => gateByChoice.get(c.id)?.fail_behavior === "hide"
      );
      const hiddenLines = hideGated.map(
        (c) => `{% if flow.variables.${gateVarName(slug, c.digit)} == "pass" %} Press ${c.digit} to ${c.label}.{% endif %}`
      ).join("");
      const roomExit = () => afterAudioName(node);
      const parts = playbackFor(graph, node.id);
      const recorded = parts.filter((p) => p.audioPath);
      const partName = (i) => i === 0 ? playName(slug) : `${slug}_line${i + 1}`;
      recorded.forEach((part, i) => {
        const last = i === recorded.length - 1;
        widgets.push({
          name: partName(i),
          type: "say-play",
          nodeId: node.id,
          note: `Play the recorded audio.${part.speaker ? ` — ${part.speaker}` : ""}`,
          playUrl: `${audioBaseUrl}${part.audioPath}`,
          transitions: [{ event: "audioComplete", next: last ? roomExit() : partName(i + 1) }]
        });
      });
      const missingParts = parts.length - recorded.length;
      if (missingParts > 0) {
        warnings.push(
          parts.length === 1 ? `${slug} has no recording, so the caller hears nothing before the choices.` : `${slug} plays line by line and ${missingParts} of its ${parts.length} lines have no take — those lines are silent.`
        );
      }
      if (hiddenLines && recorded.length > 0) {
        warnings.push(
          `${slug} hides ${hideGated.length} choice(s) behind a gate, but the room is recorded audio — nothing announces them, so a caller has to already know the digit.`
        );
      }
      if (node.node_type === "ending") continue;
      if (fight) {
        emitFight({
          graph,
          node,
          slug,
          outgoing,
          fight,
          moves,
          rounds,
          outcomes,
          audioBaseUrl,
          widgets,
          warnings,
          entryName,
          fightOutcome,
          roundName,
          roundEntry
        });
        continue;
      }
      const keyTransitions = [];
      const byDigit = doorsByDigit(graph, node.id);
      const keyOf = (choice) => {
        const group = byDigit.get(choice.digit) ?? [];
        const i = group.findIndex((c) => c.id === choice.id);
        return i <= 0 ? digitToken(choice.digit) : `${digitToken(choice.digit)}${String.fromCharCode(96 + i + 1)}`;
      };
      const destOf = /* @__PURE__ */ new Map();
      for (const conflict of keyConflicts(graph, node.id)) {
        warnings.push(
          `${slug} has ${conflict.choiceIds.length} doors on digit ${conflict.digit}. Only the first is reachable — move the others to a free key.`
        );
      }
      for (const choice of outgoing) {
        destOf.set(
          choice.id,
          emitDoor({
            graph,
            node,
            slug,
            choice,
            dkey: keyOf(choice),
            audioBaseUrl,
            widgets,
            warnings,
            gateByChoice,
            gateWidget,
            effectsFor,
            variablesFor,
            entryName,
            wname
          })
        );
      }
      for (const [digit, doors] of byDigit) {
        keyTransitions.push({
          event: "match",
          condition: `Digits equals ${digit}`,
          match: { type: "equal_to", value: digit },
          next: destOf.get(doors[0].id) ?? wname(slug, "gather")
        });
      }
      const nodeAt = (id) => id ? graph.nodes.get(id) : null;
      const timeoutTarget = nodeAt(node.timeout_target_id) ? entryName(nodeAt(node.timeout_target_id)) : replayName(node);
      const invalidTarget = nodeAt(node.invalid_target_id) ? entryName(nodeAt(node.invalid_target_id)) : replayName(node);
      if (inventory && !collidingRooms.has(slug)) {
        keyTransitions.push({
          event: "match",
          condition: `Digits equals ${inventory.key}`,
          match: { type: "equal_to", value: inventory.key },
          next: invRetName(slug)
        });
        widgets.push({
          name: invRetName(slug),
          type: "set-variables",
          nodeId: node.id,
          note: `Remember where to come back to, then read the satchel back.`,
          variables: [{ key: RET_VAR, value: slug }],
          transitions: [{ event: "next", next: INV_START }]
        });
        returnsTo.push({ slug, next: replayName(node) });
      }
      widgets.push({
        name: wname(slug, "gather"),
        type: "gather-input-on-call",
        nodeId: node.id,
        note: `Stop gathering after 1 digit; ${node.timeout_seconds}s timeout.`,
        properties: gatherProperties(node.timeout_seconds),
        transitions: [
          { event: "keypress", next: wname(slug, "keys") },
          { event: "speech", next: wname(slug, "keys") },
          { event: "timeout", next: timeoutTarget }
        ]
      });
      widgets.push({
        name: wname(slug, "keys"),
        type: "split-based-on",
        nodeId: node.id,
        note: "Which key was pressed. Anything unlisted is a wrong keypress.",
        splitOn: `{{widgets.${wname(slug, "gather")}.Digits}}`,
        transitions: [...keyTransitions, { event: "noMatch", next: invalidTarget }]
      });
      if (outgoing.length === 0) {
        warnings.push(
          `${slug} is a room with no exits and is not an ending — a caller reaching it can only time out.`
        );
      }
    }
    const root = graph.story.root_node_id ? graph.nodes.get(graph.story.root_node_id) : null;
    if (inventory) {
      for (const room of collidingRooms) {
        warnings.push(
          `${room} already uses ${inventory.key} for a door, so the caller cannot check their satchel there. Move that door to another key, or change the readback key.`
        );
      }
      for (const item of inventory.silent) {
        warnings.push(
          `${item.name || item.slug} has no recording of its name, so a caller holding it hears nothing for it in the readback.`
        );
      }
      if (!inventory.introRecorded) {
        warnings.push(
          "The inventory lead-in has no recording, so the readback starts straight in on the items."
        );
      }
      if (!inventory.emptyRecorded) {
        warnings.push(
          "There is no recording for empty hands, so a caller carrying nothing hears silence and is returned to the room."
        );
      }
      if (returnsTo.length === 0) {
        warnings.push(
          `No room can reach the inventory readback on ${inventory.key}, so it is unreachable.`
        );
      }
      const firstItem = inventory.spoken.length > 0 ? invItemCheck(inventory.spoken[0].slug) : INV_RETURN;
      const afterIntro = inventory.introRecorded ? INV_INTRO : firstItem;
      const whenEmpty = inventory.emptyRecorded ? INV_NONE : INV_RETURN;
      widgets.push({
        name: INV_START,
        type: "split-based-on",
        note: "Empty hands get their own line rather than a lead-in and then nothing.",
        splitOn: emptyHandedCondition(),
        transitions: [
          {
            event: "match",
            condition: "equal_to |",
            match: { type: "equal_to", value: "|" },
            next: whenEmpty
          },
          { event: "noMatch", next: afterIntro }
        ]
      });
      if (inventory.emptyRecorded) {
        widgets.push({
          name: INV_NONE,
          type: "say-play",
          note: "Carrying nothing.",
          playUrl: `${audioBaseUrl}${graph.story.inventory_empty_audio_path}`,
          transitions: [{ event: "audioComplete", next: INV_RETURN }]
        });
      }
      if (inventory.introRecorded) {
        widgets.push({
          name: INV_INTRO,
          type: "say-play",
          note: 'The lead-in: "you are carrying…".',
          playUrl: `${audioBaseUrl}${graph.story.inventory_intro_audio_path}`,
          transitions: [{ event: "audioComplete", next: firstItem }]
        });
      }
      inventory.spoken.forEach((item, i) => {
        const after = inventory.spoken[i + 1] ? invItemCheck(inventory.spoken[i + 1].slug) : INV_RETURN;
        widgets.push({
          name: invItemCheck(item.slug),
          type: "split-based-on",
          note: `Is the caller holding ${item.name || item.slug}?`,
          splitOn: `{{ flow.variables.${INV_VAR} | default: "|" }}`,
          transitions: [
            {
              event: "match",
              condition: `contains |${item.slug}|`,
              match: { type: "contains", value: `|${item.slug}|` },
              next: invItemPlay(item.slug)
            },
            { event: "noMatch", next: after }
          ]
        });
        widgets.push({
          name: invItemPlay(item.slug),
          type: "say-play",
          note: `"${item.name || item.slug}"`,
          playUrl: `${audioBaseUrl}${item.audio_path}`,
          transitions: [{ event: "audioComplete", next: after }]
        });
      });
      widgets.push({
        name: INV_RETURN,
        type: "split-based-on",
        note: "Back to the room the caller pressed the key in.",
        splitOn: `{{ flow.variables.${RET_VAR} }}`,
        transitions: [
          ...returnsTo.map((r) => ({
            event: "match",
            condition: `equal_to ${r.slug}`,
            match: { type: "equal_to", value: r.slug },
            next: r.next
          })),
          // Only reachable if `ret` was never set, which cannot happen by any
          // route the exporter builds — but Studio needs somewhere to go.
          { event: "noMatch", next: returnsTo[0]?.next ?? (root ? entryName(root) : "") }
        ]
      });
    }
    const total = widgets.length;
    const longestPathSteps = estimateLongestPath(graph);
    return {
      widgets,
      warnings,
      budget: { total, limit: WIDGET_LIMIT, warn: total >= WIDGET_LIMIT * 0.8 },
      longestPathSteps,
      stepCapRisk: longestPathSteps >= STEP_LIMIT * 0.8,
      entryWidget: root ? entryName(root) : null
    };
  }
  function chainedInventoryLiquid(ops) {
    let expr = `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}`;
    for (const op of ops) {
      expr += op.revoke ? `{% assign cur = cur | replace: "|${op.slug}|", "|" %}` : `{% unless cur contains "|${op.slug}|" %}{% assign cur = cur | append: "${op.slug}|" %}{% endunless %}`;
    }
    return `${expr}{{ cur }}`;
  }
  function estimateLongestPath(graph) {
    const root = graph.story.root_node_id;
    if (!root) return 0;
    const STEPS_PER_NODE = 4;
    const children = /* @__PURE__ */ new Map();
    for (const e of graphEdges(graph)) {
      if (!e.to_node_id) continue;
      if (!children.has(e.from_node_id)) children.set(e.from_node_id, []);
      children.get(e.from_node_id).push(e.to_node_id);
    }
    let best = 0;
    const cap = Math.ceil(STEP_LIMIT * 1.5 / STEPS_PER_NODE);
    const stack = [
      { id: root, depth: 1, seen: /* @__PURE__ */ new Set([root]) }
    ];
    let visits = 0;
    while (stack.length) {
      if (++visits > 2e5) break;
      const { id, depth, seen } = stack.pop();
      best = Math.max(best, depth);
      if (depth >= cap) break;
      for (const next of children.get(id) ?? []) {
        if (seen.has(next)) continue;
        const nextSeen = new Set(seen);
        nextSeen.add(next);
        stack.push({ id: next, depth: depth + 1, seen: nextSeen });
      }
    }
    return best * STEPS_PER_NODE;
  }
  function formatDuration(ms) {
    const total = Math.round(ms / 1e3);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
  }
  function audioTargets(graph) {
    const out = [];
    for (const node of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
      const lines = linesFor(graph, node.id);
      const split = lines.some((l) => l.audio_path) || lines.length > 0;
      if (!split) {
        out.push({
          key: node.slug,
          kind: "room",
          file: node.slug,
          label: node.title || node.slug,
          text: node.narration,
          currentPath: node.audio_path,
          currentDurationMs: node.audio_duration_ms,
          ref: { kind: "room", nodeId: node.id }
        });
      } else {
        lines.forEach((line, i) => {
          const who = line.character_id ? graph.characters.get(line.character_id) : null;
          out.push({
            key: `${node.slug}#${i + 1}`,
            kind: "line",
            file: `${node.slug}__line${i + 1}`,
            label: who?.name ? `${node.slug} — ${who.name}` : node.slug,
            text: line.text,
            currentPath: line.audio_path,
            currentDurationMs: line.audio_duration_ms,
            ref: { kind: "line", lineId: line.id }
          });
        });
      }
      const fight = buildFightView(graph, node.id);
      if (fight) {
        fight.rounds.forEach((round, i) => {
          out.push({
            key: `${node.slug}#r${i + 1}`,
            kind: "fight round",
            file: `${node.slug}__r${i + 1}`,
            label: `${node.slug} — ${fight.fight.opponent_name}, round ${i + 1}`,
            text: round.narration,
            currentPath: round.audio_path,
            currentDurationMs: round.audio_duration_ms,
            ref: { kind: "fight round", roundId: round.id }
          });
        });
      }
    }
    for (const choice of [...graph.choices.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const lines = linesOf(graph, { choiceId: choice.id });
      if (!choice.reaction_narration?.trim() && !choice.audio_path && lines.length === 0) continue;
      const from = graph.nodes.get(choice.from_node_id);
      if (!from) continue;
      const where = `${from.slug} — reacting to ${choice.label || `digit ${choice.digit}`}`;
      const stem = `${from.slug}__d${choice.digit}__react`;
      if (lines.length === 0) {
        out.push({
          key: `${from.slug}#d${choice.digit}react`,
          kind: "reaction",
          file: stem,
          label: where,
          text: choice.reaction_narration ?? "",
          currentPath: choice.audio_path,
          currentDurationMs: choice.audio_duration_ms,
          ref: { kind: "reaction", choiceId: choice.id }
        });
      } else {
        lines.forEach((line, i) => {
          const who = line.character_id ? graph.characters.get(line.character_id) : null;
          out.push({
            key: `${from.slug}#d${choice.digit}react${i + 1}`,
            kind: "line",
            file: `${stem}__line${i + 1}`,
            label: who?.name ? `${where} — ${who.name}` : where,
            text: line.text,
            currentPath: line.audio_path,
            currentDurationMs: line.audio_duration_ms,
            ref: { kind: "line", lineId: line.id }
          });
        });
      }
    }
    for (const gate of graph.gates.values()) {
      if (gate.fail_behavior !== "refuse") continue;
      const choice = graph.choices.get(gate.choice_id);
      const from = choice ? graph.nodes.get(choice.from_node_id) : null;
      if (!choice || !from) continue;
      out.push({
        key: `${from.slug}#d${choice.digit}`,
        kind: "refusal",
        file: `${from.slug}__d${choice.digit}`,
        label: `${from.slug} — refusing digit ${choice.digit}`,
        text: gate.fail_narration ?? "",
        currentPath: gate.fail_audio_path,
        currentDurationMs: gate.fail_audio_duration_ms,
        ref: { kind: "refusal", gateId: gate.id, choiceId: gate.choice_id }
      });
    }
    if (graph.story.inventory_key) {
      out.push({
        key: "inventory#intro",
        kind: "inventory",
        file: "inventory__intro",
        label: "Inventory lead-in",
        text: "You are carrying…",
        currentPath: graph.story.inventory_intro_audio_path,
        currentDurationMs: graph.story.inventory_intro_audio_duration_ms,
        ref: { kind: "inventory", slot: "intro" }
      });
      out.push({
        key: "inventory#empty",
        kind: "inventory",
        file: "inventory__empty",
        label: "Inventory, empty handed",
        text: "You are carrying nothing.",
        currentPath: graph.story.inventory_empty_audio_path,
        currentDurationMs: graph.story.inventory_empty_audio_duration_ms,
        ref: { kind: "inventory", slot: "empty" }
      });
      for (const v of [...graph.stateVars.values()].filter((v2) => v2.kind === "item").sort((a, b) => a.slug.localeCompare(b.slug))) {
        out.push({
          key: `item#${v.slug}`,
          kind: "item",
          file: `item__${v.slug}`,
          label: `Item — ${v.name || v.slug}`,
          text: v.name || v.slug,
          currentPath: v.audio_path,
          currentDurationMs: v.audio_duration_ms,
          ref: { kind: "item", varId: v.id }
        });
      }
    }
    for (const v of [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
      for (const move of ["gain", "spend"]) {
        const text = (move === "gain" ? v.gain_narration : v.spend_narration)?.trim();
        if (!text) continue;
        out.push({
          key: `item#${v.slug}#${move}`,
          kind: "item moment",
          file: `item__${v.slug}__${move === "gain" ? "gained" : "spent"}`,
          label: `${v.name || v.slug} — ${move === "gain" ? "picked up" : "used up"}`,
          text,
          currentPath: move === "gain" ? v.gain_audio_path : v.spend_audio_path,
          currentDurationMs: move === "gain" ? v.gain_audio_duration_ms : v.spend_audio_duration_ms,
          ref: { kind: "item moment", varId: v.id, move }
        });
      }
    }
    return out;
  }
  function buildSheet(graph, compiled, depth) {
    const out = [];
    const byNode = /* @__PURE__ */ new Map();
    for (const node of graph.nodes.values()) byNode.set(node.id, []);
    for (const w of compiled.widgets) {
      const key = w.nodeId ?? "—";
      if (!byNode.has(key)) byNode.set(key, []);
      byNode.get(key).push(w);
    }
    const sections = [...byNode.entries()].sort(([a], [b]) => {
      const da = Number.MAX_SAFE_INTEGER;
      const db = Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return byCode(graph.nodes.get(a)?.slug ?? "", graph.nodes.get(b)?.slug ?? "");
    });
    const known = new Set(compiled.widgets.map((w) => w.name));
    const placed = /* @__PURE__ */ new Set();
    out.push(`${graph.story.title} — Twilio Studio build sheet`);
    out.push("=".repeat(60));
    out.push("");
    out.push(`Widgets: ${compiled.budget.total} of ${compiled.budget.limit}`);
    out.push(`Longest route: ~${compiled.longestPathSteps} steps (cap is 1000 per call)`);
    out.push("");
    out.push("Rooms are ordered shallowest first, so working down this sheet means");
    out.push("descending the dungeon.");
    out.push("");
    out.push("A dungeon loops, so some transitions necessarily point at rooms further");
    out.push("down the sheet. Those are marked (later) — drop the widget in now and");
    out.push("wire that transition once you reach its target, or place every widget");
    out.push("first and wire the whole flow afterwards.");
    out.push("");
    out.push("Nothing in this flow is spoken by Twilio. Anything without a recording is");
    out.push("simply not emitted, so a room, round or refusal with no take is silence on");
    out.push("the phone. The audio manifest lists every one of them.");
    out.push("");
    if (compiled.warnings.length > 0) {
      out.push("BEFORE YOU START — things to check:");
      for (const w of compiled.warnings) out.push(`  ! ${w}`);
      out.push("");
    }
    for (const [nodeId, widgets] of sections) {
      const node = graph.nodes.get(nodeId);
      if (!node) continue;
      out.push(
        `─── ${node.slug}  (${node.node_type}${""}${node.audio_path ? ", recorded" : ", no audio yet"}) ${"─".repeat(16)}`
      );
      for (const w of widgets) placed.add(w.name);
      widgets.forEach((w, i) => {
        out.push(` ${i + 1}. ${widgetLabel(w.type).padEnd(18)} ${w.name}`);
        if (w.note) out.push(`      # ${w.note}`);
        if (w.playUrl) out.push(`      Play URL: ${w.playUrl}`);
        if (w.say) out.push(`      Say: ${w.say}`);
        if (w.splitOn) out.push(`      Split on: ${w.splitOn}`);
        for (const v of w.variables ?? []) {
          out.push(`      ${v.key} = ${v.value}`);
        }
        for (const t of w.transitions) {
          const label = t.condition ?? t.event;
          const forward = t.next && known.has(t.next) && !placed.has(t.next) ? "  (later)" : "";
          out.push(`      → ${label.padEnd(22)} : ${t.next ?? "(nowhere)"}${forward}`);
        }
        out.push("");
      });
    }
    out.push("");
    out.push("PATIENCE VALVE");
    out.push(
      `Studio stops an execution if the same widget runs 10 times in a row, so a caller`
    );
    out.push(
      `mashing a locked door gets hung up on. Route the ${PATIENCE_VALVE_AT}th consecutive refusal to an`
    );
    out.push("escape node instead of back to the gather.");
    return out.join("\n");
  }
  function widgetLabel(type) {
    switch (type) {
      case "say-play":
        return "Say/Play";
      case "gather-input-on-call":
        return "Gather";
      case "set-variables":
        return "Set Variables";
      case "split-based-on":
        return "Split Based On";
    }
  }
  function conditionSubject(w) {
    if (w.type === "gather-input-on-call") return `{{widgets.${w.name}.Digits}}`;
    return w.splitOn ?? "";
  }
  function studioFlowJson(graph, compiled, positions) {
    let fallbackY = 0;
    const states = compiled.widgets.map((w) => {
      const p = w.nodeId ? positions.get(w.nodeId) : void 0;
      const at = p ?? { x: 0, y: fallbackY += 200 };
      return {
        name: w.name,
        type: w.type,
        properties: {
          offset: { x: Math.round(at.x), y: Math.round(at.y) },
          ...w.say ? { say: w.say } : {},
          ...w.playUrl ? { play: w.playUrl, loop: 1 } : {},
          ...w.splitOn ? { input: w.splitOn } : {},
          // `index` is what the Studio console itself emits for every variable,
          // and matching its output exactly is cheaper than finding out which
          // fields the TypedParameter schema treats as required.
          ...w.variables ? { variables: w.variables.map((v, i) => ({ index: String(i), ...v })) } : {},
          ...w.properties ?? {}
        },
        transitions: w.transitions.map((t) => ({
          event: t.event,
          ...t.match ? {
            conditions: [
              {
                friendly_name: t.condition ?? t.match.value,
                // What is being compared belongs to the WIDGET: a split
                // declares its input, a gather compares its own digits.
                arguments: [conditionSubject(w)],
                type: t.match.type,
                value: t.match.value
              }
            ]
          } : {},
          next: t.next ?? void 0
        }))
      };
    });
    return JSON.stringify(
      {
        description: graph.story.title,
        states: [
          {
            name: "Trigger",
            type: "trigger",
            properties: { offset: { x: 0, y: -150 } },
            transitions: [
              // The compiler decides where a call starts. An unrecorded entrance
              // has no play widget, and one with arrival effects starts at those.
              { event: "incomingCall", next: compiled.entryWidget ?? void 0 },
              { event: "incomingMessage" },
              { event: "incomingRequest" }
            ]
          },
          ...states
        ],
        initial_state: "Trigger",
        flags: { allow_concurrent_calls: true }
      },
      null,
      2
    );
  }
  function audioManifestCsv(graph) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const words = (text) => String(text.trim() ? text.trim().split(/\s+/).length : 0);
    const wanted = new Map(audioTargets(graph).map((t) => [t.key, t.file]));
    const rows = [
      ["kind", "slug", "call it", "title", "status", "filename", "duration", "words"].join(",")
    ];
    const push = (kind, slug, title, status, path, ms, text) => rows.push(
      [
        esc(kind),
        esc(slug),
        esc(wanted.get(slug) ?? ""),
        esc(title),
        esc(status),
        esc(path ?? ""),
        esc(ms ? formatDuration(ms) : ""),
        words(text)
      ].join(",")
    );
    for (const n of [...graph.nodes.values()].sort((a, b) => byCode(a.slug, b.slug))) {
      const lines = linesFor(graph, n.id);
      const split = lines.some((l) => l.audio_path);
      if (!split) {
        push("room", n.slug, n.title, n.status, n.audio_path, n.audio_duration_ms, n.narration);
      }
      if (split) {
        lines.forEach((line, i) => {
          const who = line.character_id ? graph.characters.get(line.character_id) : null;
          push(
            "line",
            `${n.slug}#${i + 1}`,
            who?.name ?? "",
            line.audio_path ? "recorded" : "missing",
            line.audio_path,
            line.audio_duration_ms,
            line.text
          );
        });
      }
      const fight = buildFightView(graph, n.id);
      if (fight) {
        fight.rounds.forEach((round, i) => {
          push(
            "fight round",
            `${n.slug}#r${i + 1}`,
            fight.fight.opponent_name,
            round.audio_path ? "recorded" : "missing",
            round.audio_path,
            round.audio_duration_ms,
            round.narration
          );
        });
      }
    }
    for (const gate of graph.gates.values()) {
      if (gate.fail_behavior !== "refuse") continue;
      const choice = graph.choices.get(gate.choice_id);
      const from = choice ? graph.nodes.get(choice.from_node_id) : null;
      push(
        "refusal",
        `${from?.slug ?? "?"}#d${choice?.digit ?? "?"}`,
        "refusal",
        gate.fail_audio_path ? "recorded" : "missing",
        gate.fail_audio_path,
        gate.fail_audio_duration_ms,
        gate.fail_narration ?? ""
      );
    }
    return rows.join("\n");
  }
  function printableScript(graph, onlyActor) {
    const speaksHere = (nodeId) => true;
    const out = [
      graph.story.title + "",
      "=".repeat(60),
      ""
    ];
    const nodes = [...graph.nodes.values()].filter((n) => speaksHere(n.id)).sort((a, b) => byCode(a.slug, b.slug));
    for (const n of nodes) {
      out.push(`## ${n.slug}${n.title ? ` — ${n.title}` : ""}`);
      if (n.status === "approved") out.push("(approved)");
      else if (n.audio_path) out.push("(recorded, not yet approved)");
      out.push("");
      const lines = linesFor(graph, n.id);
      if (lines.length === 0) {
        out.push(n.narration || "(nothing written yet)");
      } else {
        for (const line of lines) {
          const character = line.character_id ? graph.characters.get(line.character_id) : null;
          const who = character ? `${character.name}: ` : "";
          out.push(`${" "} ${who}${line.text}`);
        }
      }
      const fight = buildFightView(graph, n.id);
      if (fight) {
        out.push("");
        out.push(`   [fight: ${fight.fight.opponent_name}]`);
        fight.table.forEach(({ round, cells }, i) => {
          out.push(`   ${i + 1}. ${round.narration || round.opponent_move}`);
          for (const cell of cells) {
            out.push(`        ${cell.digit} ${cell.move.slug} → ${cell.where}`);
          }
        });
      }
      const exits = [...graph.choices.values()].filter((c) => c.from_node_id === n.id).sort((a, b) => a.sort_order - b.sort_order);
      if (exits.length > 0) {
        out.push("");
        for (const e of exits) out.push(`   Press ${e.digit} to ${e.label || "…"}`);
      }
      if (n.notes) {
        out.push("");
        out.push(`   [note: ${n.notes}]`);
      }
      out.push("");
      out.push("");
    }
    return out.join("\n");
  }
  function exportForTwilio(rowsJson, positionsJson = "{}") {
    const graph = graphFromRows(JSON.parse(rowsJson));
    const compiled = compileStory(graph, "");
    const positions = new Map(Object.entries(JSON.parse(positionsJson)));
    return JSON.stringify({
      flow: studioFlowJson(graph, compiled, positions),
      sheet: buildSheet(graph, compiled),
      manifest: audioManifestCsv(graph),
      script: printableScript(graph),
      warnings: compiled.warnings,
      widgets: compiled.budget.total,
      limit: compiled.budget.limit,
      entry: compiled.entryWidget
    });
  }
  exports.exportForTwilio = exportForTwilio;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
