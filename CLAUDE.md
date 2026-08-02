# CLAUDE.md — The Delve

Project context for Claude Code. Read this first, every session. The full product
spec is the source of truth at **`docs/delve-spec.md`** — when this file and the
spec disagree, the spec wins; update this file to match.

## What we're building

**The Delve** is a dungeon-crawl authoring tool for a Twilio Studio
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
| Art direction | Flat vector, behind a renderer seam so a sprite pack can drop in later (§11.4). |
| Audio hosting | Supabase Storage public bucket. The exporter emits those URLs into Twilio Play widgets. |
| Text-to-speech | **Never in the exported flow.** Anything without a recording is not emitted at all — a room, line, fight round or refusal with no take is silence on the phone, and the export says so. The playtest still speaks unrecorded lines; that's a rehearsal aid, clearly labelled. |
| Twilio export | Build sheet (§6.6 path B) first, then flow-definition JSON (path A). **No REST push, no writes to the Twilio account.** |
| `node_type` | `room \| ending`. `hub` was cut — the spec listed it but never defined its behaviour. |
| Exits per room | 3 on the walls; digits 4–9 render as a stacked list (F1.13). |
| Flat vs subflows | Stay flat. The widget budget meter says when to revisit (§11.2). |
| Default gate fail | `refuse` — it teaches the player the item exists (§11.3). |
| Counter clamp | 10, per story, configurable. The solver needs a ceiling or it never terminates (§11.5). |
| Dialogue | Narration splits into attributed lines. A room is one recording by default; record a line and the room switches to playing its lines in order, then offering its exits. That's what lets two separately-booked actors share a scene. |
| Characters | A cast list with voice-actor assignment. Doesn't change the flow's shape; a recorded line does become its own Play widget. |
| Collapsing a room | The import made a room out of every node in the source file, including the ones that were *actions* — "enter door" is something you do on the way through, not somewhere you stand. Collapse splices a room out and joins the two either side (`src/features/room/collapse.ts`). Refused for the entrance, endings, fights, forks, self-loops and anything carrying dialogue, effects or gates — so the undo can be complete. An unlabelled door inherits the collapsed room's name, because those words were only ever heard by the room reading itself out. |
| Exit order | The digit the caller presses, and nothing else. `sort_order` only breaks ties, which is what keeps digit-less fight edges behind every real key. |
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
   rewrites `nodes.narration` from the lines. Two independently-edited copies of
   the script would drift, and the recorded one is the one that ships.
   What a room *plays* is `playbackFor` — one file, or a line take each. The
   torch is lit only when every part has audio.
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
