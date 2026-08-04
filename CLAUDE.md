# CLAUDE.md — Jackie Dungeon

Project context for Claude Code. Read this first, every session. The full product
spec is the source of truth at **`docs/delve-spec.md`** — when this file and the
spec disagree, the spec wins; update this file to match.

## What we're building

**Jackie Dungeon** is a dungeon-crawl authoring tool for a Twilio Studio
choose-your-own-adventure IVR. You stand in a room, the exits are your choices,
and a graph-paper automap shows the structure. It compiles to a Twilio Studio
flow. See spec §0.

Two rules from §0 that everything else follows from:

1. **Every visual element encodes real data.** A lit torch means recorded audio
   exists. A bricked archway means an unwritten branch. Nothing is atmosphere
   for its own sake.
2. **You never position anything.** Layout is derived — the automap auto-lays-out
   from the node graph, the room view renders from one node's record. **There is
   no dragging anywhere in this app.**

## Decisions (settled during spec review — don't re-litigate)

| Question | Decision |
|---|---|
| Repo / hosting | Source lives here; Dabingabongo's Netlify config serves it at `dabingabongo.com/delve`. Vite `base` is `/delve/`. |
| Type | Carved is **Uncial Antiqua** — medieval, and specifically uncial because everything wearing that class is uppercased and letterspaced. Blackletter caps are unreadable and Grenze Gotisch turned "ANNOUNCE THE DOORS" into a smear; uncial forms ARE majuscule, so they survive it down to the 9px plates. Self-hosted latin subset, like the others. `CARVED` in `vector/geometry.ts` names it for SVG text that cannot reach a Tailwind class. |
| Art direction | Flat vector, behind a renderer seam so a sprite pack can drop in later (§11.4). 18 designs — the caves are deliberately several (dripstone, crystal, the crawl, the chasm), because a story that spends twenty rooms underground needs them to look like different places. `/preview` is the bench: nav down the side, one piece large. |
| Audio hosting | Supabase Storage public bucket. The exporter emits those URLs into Twilio Play widgets. **Every take is converted to 8 kHz mono 16-bit PCM WAV in the browser before upload** (`src/features/audio/ivrWav.ts`). `<Play>` accepts only mpeg / wav / aiff / gsm / ulaw — and MediaRecorder produces webm or m4a, neither of which is on that list, so an unconverted take is silence on the phone. |
| Text-to-speech | **Never in the exported flow.** Anything without a recording is not emitted at all — a room, line, fight round or refusal with no take is silence on the phone, and the export says so. The playtest still speaks unrecorded lines; that's a rehearsal aid, clearly labelled. |
| Twilio export | Build sheet (§6.6 path B) first, then flow-definition JSON (path A). **No REST push, no writes to the Twilio account.** The JSON must satisfy Twilio's published schema (`twilio.com/docs/studio/rest-api/v2/schemas`), and `src/features/export/schema.test.ts` is what holds it there: a gather takes only `keypress`/`speech`/`timeout` and carries NO conditions, only a split may; there is no `hangup` widget (a call ends by reaching a transition with no target); `states` caps at **1000**. Getting any of these wrong fails validation with nothing but "Something went wrong". |
| `node_type` | `room \| ending`. `hub` was cut — the spec listed it but never defined its behaviour. |
| Win vs death | `nodes.ending_kind` (`death \| win \| null`, null reads as death). **Nothing about the exported flow changes** — both end the call by reaching a transition with no target. It is what the room draws (rubble and a skull, or the wall opening into daylight), what the map draws (a red X, or a gold ring), and how the survey splits its tally, because "12 endings" never said whether the story could be won. |
| Exits per room | The wall shows the doors that exist plus **one** blank arch to chisel through, up to `MAX_WALL_ARCHES` (5); the rest stack below (F1.13). Arch width and height come from `archBox(count)` — one door is not three doors with two missing, and three keeps exactly the numbers it always had so no existing room moved. |
| Flat vs subflows | Stay flat. The widget budget meter says when to revisit (§11.2). |
| Default gate fail | `refuse` — it teaches the player the item exists (§11.3). |
| Counter clamp | 10, per story, configurable. The solver needs a ceiling or it never terminates (§11.5). |
| Dialogue | Narration splits into attributed lines. A room is one recording by default; record a line and the room switches to playing its lines in order, then offering its exits. That's what lets two separately-booked actors share a scene. |
| Characters | A cast list with voice-actor assignment. Doesn't change the flow's shape; a recorded line does become its own Play widget. |
| Who is in the room | `characters.figure` (5 silhouettes, null = nobody) stands a named figure in every room that character speaks in. **Opt-in, because "who speaks" and "who is present" are different questions** — the party is the caller and the narrator is nobody, so drawing every voice would put three people in a room you are alone in. Drawn in the **wings** either side of the archways (`vector/figureLayout.ts`, pure and tested), with the name at the FEET — above the head it sat at the wall base, which is where the arches are, and one figure centred itself on the middle door with its plate across the opening. **Two drawn, one per wing**; a third would have to stand in the arch band, so the rest are named along the front. Placement is solved per silhouette because a beast is half again as wide as a person, and an asymmetric one is **mirrored to face inward** so the frame crops its tail rather than its head. |
| What an item says | `state_vars.gain_*` / `spend_*` — a clip heard when the item is picked up, and one when it is used up. **On the ITEM, not on the effect**: a rope picked up at three doors is one sentence, and putting it on the effect meant writing and recording it three times. A door's REACTION stays the place for what is true of that threshold only. `features/state/itemClips.ts` is pure and shared, and takes either shape of effect — the exporter knows the item by id, the playtest by slug, and one function answering both is what keeps them in step. Emitted **after** the widget that moves the item and before the room it leads to: said before the caller has the thing, it is a promise rather than a description. `set` on a counter is NOT a gain — being told you now have three is bookkeeping. Unrecorded is silence and is reported. |
| Inventory readback | One reserved key (`*` or `#`, the only two that are never doors), pressed in any room, plays what the caller is holding and returns them to the room's **replay** — never its entry, or checking your pockets re-runs arrival effects and grants the item again. Emitted ONCE and shared: Studio has no subroutine, so each room leaves a note in `ret` on the way out and a split at the far end sends the caller back. Items need a take of their name; unrecorded is silence and is reported. Off by default, and not offered mid-fight. |
| Door reactions | A choice carries its own script and take — what is heard between the keypress and the next room. It belongs to neither room either side: in the one you left, every other door hears it; in the one you arrive at, it replays when you return another way. Emitted **inside the gate and after the effects**, so a refused caller never hears the reaction to what they were refused. Reached from "Show where doors lead", beside the label it answers, not from the editor's exits row. Walking through a door that has one stops at a modal that plays it first (`ReactionGate`) — an ordinary door still walks straight on. |
| A reaction is dialogue too | A `dialogue_lines` row hangs off **a node or a choice** — two nullable FKs and a CHECK, the same shape as `effects`. So a reaction splits by speaker, casts, and records a line at a time exactly as a room does, and one `DialogueSection` over a `LineOwner` serves both. Once its lines carry takes, the file on the choice is no longer what plays. |
| Collapsing a room | The import made a room out of every node in the source file, including the ones that were *actions* — "enter door" is something you do on the way through, not somewhere you stand. Collapse splices a room out and joins the two either side (`src/features/room/collapse.ts`). Refused for the entrance, endings, fights, forks, self-loops and anything carrying dialogue, effects or gates — so the undo can be complete. An unlabelled door inherits the collapsed room's name, because those words were only ever heard by the room reading itself out. |
| Inserting a room | Collapse's inverse, on the door it applies to: A -> B becomes A -> new -> B. Built forwards — new room, its way onward, and only then repoint the original door — so a part-way failure leaves a stray room the ledger reports, never a dead end. Walks you into the new room. |
| The map is a survey, not a picture | Rooms are filled by how far along they are (inked = recorded, pale = written, dotted = empty, red = sealed), so a zoomed-out map of 139 rooms answers "how much is left" with nothing legible. Names appear only when there is room to read them. `surveyStory` (`src/features/automap/survey.ts`) is the page's tallies, and **every tally carries the room ids behind it** — tapping one lights those rooms up. A number you cannot act on is decoration. Tapping a room opens its card; leaving is the card's own button. |
| Exit order | The digit the caller presses, and nothing else. `sort_order` only breaks ties, which is what keeps digit-less fight edges behind every real key. |
| A door's words are the door's | Three separate pieces of writing meet at a threshold and none of them may borrow another: the door's **label**, the **reaction** to taking it, and the **name of the room behind**. "Announce the doors" emits nothing for an unlabelled door and says which digits it skipped (`unlabelledDoors`) — falling back to the room's title made that room's name into the previous room's script, and left two doors to one place announcing identical words. Two doors to the same room having different labels is the *normal* shape ("force the locker" / "pick the lock"), not an edge case. |
| Slug vs title | A chiselled room's slug comes from the door label, because a slug is an identifier and ENTER_THE_DOOR beats ROOM_87 in the bucket and in Studio's widget names. It then **follows the title once**, on the unnamed → named step (`src/features/graph/naming.ts`) — otherwise the door's wording stayed the room's identity forever. It deliberately does *not* follow later renames: by then a manifest is in an actor's hands and a flow is in Studio. |
| Readings — **cut** | `node_variants` and `hidden_doors` were a second way to say what a **fork on a door** already says, and the more expensive way. A reading with a `goto` is an arrival fork written once on the room instead of once per door in; a reading with hidden doors is a state, which is the model the room view stopped showing. Measured, the widget cost is a wash (two recorded readings +4; one forked twin room +5), so the only thing keeping them was that a twin room duplicates doors and effects and can drift — a real cost, and a smaller one than two mechanisms for one job. 0020 drops both tables, **appending every reading's words to its room's `notes` first** (script is the one thing that cannot be reconstructed) and saying in the note when a take was orphaned. `unique (from_node_id, digit)` is deliberately NOT restored: rows written under 0019 may violate it, and a migration failing on live data is a worse way to learn that than the marker `keys.ts` puts on the door. |
| One key, two ROOMS | The plainest answer to "press 1 goes somewhere else if you have the helmet", and usually the right one: a **fork on the door** (`ForkSheet`), reached beside the destination it splits. Underneath it is a `divert` gate — in the schema since 0001, exported and playtested the whole time, but spelled "Require something → if they can't → send them somewhere else" three levels into the Items tab. Two ordinary rooms, each with its own name, script, cast and exits, so nothing is shared and nothing is a state. **A divert is a fork, not a refusal**, so the door's reaction now wraps the whole split rather than the passing branch — both routes hear it, in the export and in the playtest. Choice effects still fire on the pass route only; the UI says so. **Walking through a forking door stops at `ForkGate`** and asks which of the two rooms to stand in — the same failing `ReactionGate` fixes, that what lives BETWEEN two rooms can be seen from neither, and without it the fail route was a room you had built and could only reach by the map. A route with nowhere to go yet is wired from that modal. **This is now the only conditional-destination mechanism in the app.** |
| A divert is an EDGE | `graphEdges` emits `kind: 'divert'` for a diverting gate's `fail_node_id`. It never did, so the map never drew the far side of a fork and the ledger reported that room as sealed — the identical failure that made the fight edges necessary. Excluded from the solver's choices: it reaches that room through the gate on the choice, which is where the condition lives. |
| One key, two doors | Was the point of dropping `unique (from_node_id, digit)` in 0019 — with a wall per state, "press 2" could be a different door in each. With readings gone it is a **story bug**: checked in `features/room/keys.ts` and reported (room marker, editor, export warning) rather than refused, because the rows can already exist. The export emits **one** transition per digit — two `Digits equals 2` off one split and Studio silently takes the first — and names the second door's widgets `_d2b_`, because duplicate names are error 81022's second cause. |
| Twilio import blockers found the hard way | A gather's schema is `oneOf [required say, required play]`, and every gather here is silent — so `gatherProperties` emits **`say: ''`**, without which the whole definition fails validation with only "Something went wrong". Set-variables carry `index` on each variable, matching what the console emits. Split transitions use **`conditions`** (plural) even though the published schema says `condition` — Twilio's own samples and console exports use the plural, and the schema does not forbid extra keys. `schema.test.ts` pins all three, and error 81022's three causes (schema mismatch, duplicate widget names, transition to a missing widget) each have a test. |
| Either of two items | The gate builder always had `or`; it was two bare words that appeared only after a second condition. Now spelled out ("all of these" / "any one of these") with a plain-English readback from `describeExpression`, which the call sheet uses too. **`consume_on_pass` walks the tree rather than flattening it** (`consumedBy`): an `and` spends every branch, an `or` spends only the first that HELD — a caller carrying the crowbar and the key used to lose both. The exporter emits it at all now, which it never did: `consume_on_pass` was honoured by the playtest and the solver and by nothing on the phone. |
| Looping a door back | A door's destination is picked from **the way you came, then where you have been, then everything else behind a search** (`src/features/room/loopBack.ts`) — not the 139-room alphabetical list it was, which buried the one room the author was trying to get back to. `wayTo` is a BFS from the entrance keeping predecessors, over `graphEdges`, so a fight's win room is on the way here too. A candidate is marked `↺ loops` when it is an ancestor, because that is the edge that draws as a stairwell (F1.6). The **blank arch** can be wired this way as well, not only chiselled through — a loop back to a hub is a new door to an old room, and without that the only way to make one was to cut a room and then re-point it. |
| One person, cast twice | The import spells a name however the script did, so a real story came back with **Froggem** and **Froggum**, one line each. `features/cast/merge.ts` offers near-misses on the Cast page — **optimal string alignment**, not plain Levenshtein, because the commonest typo is a swap (`Carter`/`Cartre`) and Levenshtein charges that two. Tolerance scales to the SHORTER name, which is what keeps `Shark` and `Shark King` apart. Suggested, never automatic: only somebody who read the story knows. The merge repoints the lines **and recomposes every affected owner's narration** — principle 8, the script carries the speaker's NAME as text, so repointing `character_id` alone would leave the room still saying "Froggum:" until the next line edit rewrote it back. Lines are UPDATED, not replaced, so takes and ids survive. |
| Help | `features/app/help.ts` — every feature, what it does, **where it is tap by tap**, and what has to be true first. A description with no path is a feature that still cannot be found, and three were: the call sheet was an underlined half-sentence three sections down the Cast page, the figure control was an unlabelled select whose only explanation was a `title` tooltip (which does not exist on touch), and a figure draws nothing until the room's script is split by speaker. `needs` is drawn in the alarm colour because most of what looks broken here is a prerequisite nobody mentioned. One list, searchable over the `where` line as well as the title. |
| Changelog | `features/app/changelog.ts`, opened by the version button in the header's first line. **One copy** — a `CHANGELOG.md` beside it would be two hand-maintained lists of the same facts. A test pins its top entry to `package.json`. |
| Fights | A first-class kind of room (a `fights` row hung off a node, not a `node_type`). **Functionally a room where you pick an exit**: each round names where every digit goes, and several may go to the same place. The counter rule (matching move advances, everything else loses) is only the default when a round doesn't name one. An unmapped digit loses; silence repeats the round `silence_patience` times first. |

## Spec gaps resolved in code

- §4.4 says playtest enforces `requires_item`; no such field exists. It's `gates`.
- F5.4 enforces a per-node timeout with no column for it → added `nodes.timeout_seconds`.
- §2's `effects` used a polymorphic `owner_type`/`owner_id`; implemented as two
  nullable FKs with a CHECK, which buys referential integrity and cascade deletes.

## Stack

React + Vite + TypeScript, Tailwind, **Zustand** (one graph in memory), Supabase
(Postgres + Auth + Storage), `elkjs` for automap layout, `MediaRecorder` for
capture. pnpm. Target device order: **tablet portrait, then phone, then desktop.**

## Architecture principles

1. **Derived, never stored.** Depth, orphans, back-edges, reachability are all
   recomputed from the graph (`src/features/graph/derived.ts`). Never persist them.
2. **Back-edges need a DFS colour map, not a depth compare.** A cross-edge to a
   shallower node is reconvergence (a door); only an edge to a node still open on
   the stack is a portal (a stairwell). Getting this wrong was the flowchart's
   worst failing.
3. **The room model is pure.** `src/features/room/roomModel.ts` turns
   (graph, derived, nodeId) into a `RoomView` with no React in it. Renderers
   consume that and nothing else — that's the seam sprites would slot into.
4. **RLS-first.** Every table has Row Level Security from the migration that
   creates it. The `voice` role's column restriction is a trigger, because
   row-level policies cannot scope an UPDATE to specific columns.
5. **Optimistic writes with rollback.** Autosave-on-blur applies locally first,
   then reconciles; a rejected write rolls back so the UI never claims a save
   that didn't happen.
6. **Undo replays inverse operations against the database**, not local snapshots.
   Every mutation is already persisted, so a snapshot-restore would be undone by
   the next read.
7. **Structure is derived over EDGES, not choices.** A fight's win and lose
   rooms are reached without any choice row existing, so depth, reachability,
   orphans, portals, traps, the automap and the solver all read
   `graphEdges(graph)` (`src/features/graph/edges.ts`). Only a room's *exits*
   are choices. Getting this wrong reported every post-fight room as sealed.
8. **The narration and the lines are one thing seen twice.**
   `splitNarration` and `composeNarration` are inverses, and every line edit
   rewrites the owner's text from the lines — `nodes.narration` for a room,
   `choices.reaction_narration` for a door. Two independently-edited copies of
   the script would drift, and the recorded one is the one that ships.
   What is *played* is `playbackFor` / `reactionPlaybackFor` — one file, or a
   line take each. Never read `audio_path` to ask whether something is recorded:
   once it splits, that column is not what plays. The torch is lit only when
   every part has audio.
11. **Everything points at `entryName`, never at `<slug>_play`.** A room's first
   widget is its arrival effects, then its batched gates, then its audio — and
   an unrecorded room has no audio widget at all. Targeting `_play` by name
   skipped the effects and the gates outright, and now would point at nothing.
9. **Playtest and export must agree about fights.** Both ask
   `resolveMove` (`src/features/fight/model.ts`) where a digit goes — neither
   decides for itself, and both count silence against the same
   `silence_patience`. A rule added to one and not the other is a bug that only
   shows up on the phone.
10. **Pipe-delimit inventory tests.** Studio's `contains` matches substrings, so
   `ROPE` would match `ROPEBURN`. Always wrap in `|`. Same class of bug bit the
   importer's column matching — use whole-word matching, never `includes`.

## Recording workflow

Three ways in — held down in a room, worked through at `/story/:id/record`,
or a folder dropped at `/story/:id/audio` — and **all three run the same four
steps from `useTakeWriter`**: convert, upload, point the row at it, and only
then delete the file it replaced. That order is the part worth guarding, and
three copies of its `assign` switch would be three chances to forget a kind.
The queue runs in **story order** (`features/audio/queue.ts`), not by slug: an
actor reads front to back. Per-actor call sheets on the Cast page are built
over the same `audioTargets`, so the filename on the sheet is the string the
importer matches on.

Takes can be recorded in the app or brought in finished. `src/features/audio/targets.ts`
is the single list of every recordable slot and **what to call its file** — the
audio manifest's `call it` column and the bulk importer (`/story/:id/audio`)
both read it, so they can never disagree. Hold-to-record is guarded against a
scroll that starts on the button (`useHoldToRecord`), and every take can be
cleared: an accidental one-second take is worse than none, because it reads as
a recorded room and plays as silence.

## Cleaning up after the import

`/story/:id/tidy` — the Brainstorm export had no concept of a room, so every
node became one and its text became the name. Two passes (`features/room/tidy.ts`),
both suggestions, neither automatic: short names for sentence-titles (the old
title moves into the narration, where it was always meant to be), and rooms
that were actions. `planCollapse` still has the final say on the second, so
nothing offered can lose dialogue, items, gates or a fight.

## Repo layout

```
src/
  features/
    graph/      store (zustand) + edges + derived structure
    cast/       dialogue split/compose (pure) + cast helpers + DialogueSection
    fight/      fight model (pure) + FightSection
    room/       roomModel (pure) + RoomStage (renderer seam) + EditorSheet
    import/     CSV parse -> column mapping -> plan -> commit
    auth/       session hook
  lib/          supabase client, slug, speech estimates, api
  routes/       one file per screen
  types/        domain types — mirror the migrations
supabase/migrations/
docs/delve-spec.md
```

## Build phases (spec §10)

1 skeleton walker + import · 2 dungeon dressing · 3 audio · 4 structure ·
4.5 items & state solver · 5 playtest · 5.5 collaboration · 6 export · 7 polish.

Build one phase at a time; resist pulling later phases forward. Each phase ends
with `pnpm typecheck && pnpm lint && pnpm test` clean and a commit.

## Commands

```
pnpm dev | build | preview | typecheck | lint | test
```

## Environment

`.env` (gitignored) and the Netlify UI need:

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Supabase project: **the-delve** (`tzfkylvtndgaugbgxbuc`).

## Deploying

This repo is not a Netlify site. Dabingabongo's `build.sh` clones it at
`${DELVE_REF:-main}` and builds `/delve`, so **only what is on `main` ships**.
`.github/workflows/deploy.yml` verifies a push to `main` and then pings a Netlify
build hook, whose URL is the repo secret `NETLIFY_BUILD_HOOK_URL`. Set `DELVE_REF`
in the Netlify UI to put an unmerged branch on the live site.
