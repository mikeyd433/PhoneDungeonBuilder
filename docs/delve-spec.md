# Jackie Dungeon — Build Spec

**A dungeon-crawl authoring tool for a Twilio Studio choose-your-own-adventure IVR.**

Named *Jackie Dungeon*.

---

## 0. The thesis

A first-person dungeon crawler is already a drill-down tree navigator wearing a costume. You stand in a room, the exits are your choices, and a graph-paper automap in the corner tells you where you've been. That's the same data structure as an IVR node graph — it just doesn't ask you to hand-position anything.

Two rules keep this from drifting into decoration:

1. **Every visual element encodes real data.** A lit torch means recorded audio exists. A bricked archway means an unwritten branch. A rubble pile means a terminal node. Nothing is atmosphere for its own sake.
2. **You never position anything.** Layout is derived. The automap auto-lays-out from the node graph; the room view renders from one node's record. Dragging is what made the flowchart clunky, so there is no dragging anywhere in this app.

The app has two visual worlds, and the contrast between them *is* the design:

- **The dungeon** — warm, torchlit, carved stone. This is where you write and record.
- **The surveyor's notebook** — cold blue graph paper, hand-inked. This is where you see structure, find orphans, and check your work.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React + Vite + TypeScript | Matches your existing setup |
| Styling | Tailwind | Custom tokens in `tailwind.config.js`, see §3 |
| State | Zustand | Lighter than Redux, good for a single graph in memory |
| Backend | Supabase (Postgres + Auth + Storage) | Audio in Storage, nodes in Postgres |
| Auth | Magic link | Same pattern as Stroke Off |
| Audio capture | `MediaRecorder` API | Records directly in-browser on phone |
| Automap layout | `elkjs` (layered algorithm) | Better than dagre for graphs with back-edges |
| Hosting | Netlify → `dabingabongo.com/delve` | |
| Offline | IndexedDB write queue, sync on reconnect | Van has bad signal; see F7.4 |

**Target device first:** tablet in portrait, then phone, then desktop. The room view is designed for a thumb.

---

## 2. Data model

### `stories`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `root_node_id` | uuid FK → nodes | The dungeon entrance |
| `owner_id` | uuid FK → auth.users | |
| `created_at` / `updated_at` | timestamptz | |

### `nodes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `story_id` | uuid FK | |
| `slug` | text, unique per story | `SHARKS_1` — your existing convention |
| `title` | text | Short human label, e.g. "Circling in the dark" |
| `narration` | text | The script the caller actually hears |
| `node_type` | enum | `room` \| `ending` \| `hub` |
| `audio_path` | text nullable | Supabase Storage path |
| `audio_duration_ms` | int nullable | For the 15-second warning, F2.7 |
| `status` | enum | `stub` \| `scripted` \| `recorded` \| `approved` |
| `notes` | text nullable | Production notes, not heard by caller |
| `timeout_target_id` | uuid nullable | Where a silent caller goes |
| `invalid_target_id` | uuid nullable | Where a wrong keypress goes |
| `created_at` / `updated_at` | timestamptz | |

### `choices`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `from_node_id` | uuid FK | |
| `digit` | text | `1`–`9`, `0`, `*`, `#` |
| `label` | text | "Grab the harpoon" — read aloud as part of narration |
| `to_node_id` | uuid nullable | **null = bricked archway, an unwritten branch** |
| `sort_order` | int | Left / center / right wall placement |

### `state_vars` — items, flags, and counters
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `story_id` | uuid FK | |
| `slug` | text, unique per story | `HARPOON`, `TRUSTED_CAPTAIN`, `ROPE_LENGTH` |
| `name` | text | "the rusted harpoon" — used in spoken inventory readback |
| `kind` | enum | `item` \| `flag` \| `counter` |
| `description` | text nullable | |
| `is_consumable` | bool | Auto-revoked when used to pass a gate |

Flags and counters use the same machinery as items — a flag is an item the caller can't see, a counter is an item with a number attached. Keeping them in one table means one validation pass covers all three.

### `effects` — what a decision *does*
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_type` | enum | `node` \| `choice` |
| `owner_id` | uuid | |
| `state_var_id` | uuid FK | |
| `operation` | enum | `grant` \| `revoke` \| `set` \| `add` |
| `amount` | int nullable | For `add` / `set` on counters |
| `sort_order` | int | Effects apply in order |

**Effects attach to choices, not just nodes.** This is the piece you asked for. "You are in a room containing a harpoon" shouldn't grant it — *choosing to pick it up* should. A node-level effect fires on arrival; a choice-level effect fires when that digit is pressed. Most of your item logic should live on choices.

### `gates` — what a decision *requires*
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `choice_id` | uuid FK, unique | One gate per choice |
| `expression` | jsonb | Boolean tree, see below |
| `fail_behavior` | enum | `hide` \| `refuse` \| `divert` |
| `fail_narration` | text nullable | For `refuse` — "The gate won't budge." |
| `fail_node_id` | uuid nullable | For `divert` |
| `consume_on_pass` | bool | Revoke consumable items used by this gate |

**Expression format** — a small JSON tree, built in the UI, never typed by hand:

```json
{ "op": "and", "args": [
  { "op": "has",   "var": "HARPOON" },
  { "op": "not",   "args": [{ "op": "has", "var": "WOUNDED" }] },
  { "op": "gte",   "var": "ROPE_LENGTH", "value": 3 }
]}
```

Supported ops: `has`, `lacks`, `and`, `or`, `not`, `gte`, `lte`, `eq`. That covers essentially every gate a phone adventure needs, and compiles cleanly to Liquid (see §6.3).

**Three fail behaviors, because they sound different to a caller:**

| Behavior | What the caller experiences |
|---|---|
| `hide` | The choice isn't read aloud at all. The door isn't there. |
| `refuse` | The choice is offered, pressing it plays `fail_narration`, then returns to the same node. "The gate won't budge — you'd need something to pry it." |
| `divert` | Pressing it sends them somewhere else entirely. Good for traps. |

`hide` is cheapest in widgets but the most confusing to a caller who's replaying. `refuse` is the best default — it teaches the player that the item exists.

### Derived, never stored
- **Portal vs. door** — a choice is a portal if `to_node_id` is an ancestor of `from_node_id` (back-edge)
- **Orphan** — a node with no inbound choices and not the root
- **Depth** — BFS from root, used for automap layering and the descent indicator

### Constraints worth enforcing in Postgres
- Unique `(from_node_id, digit)` — no two choices on the same keypad digit
- Unique `(story_id, slug)`
- `nodes` of type `ending` may not have choices (enforce in app, not DB, so you can convert types freely)

---

## 3. Visual design tokens

### Palette

```js
// tailwind.config.js — colors
'depth':     '#141010',  // deepest shadow, background behind everything
'stone':     '#2B241E',  // wall base, warm not neutral
'stone-lit': '#4A3D30',  // wall under torchlight
'mortar':    '#6B5A47',  // carved edges, joins
'torch':     '#E8A33D',  // THE accent — lit torch, active state, recorded status
'ember':     '#B85C1E',  // secondary warm, hover states
'cold':      '#41525C',  // unlit, unwritten, disabled — the absence of torch
'parchment': '#E4D9BE',  // narration plaque, primary text on dark
'grave':     '#8C2F22',  // endings, destructive actions, dead ends
'paper':     '#D6E4EC',  // automap background
'grid':      '#8FB0C2',  // automap grid lines
'ink':       '#1F3A4A',  // automap hand-drawn lines and lettering
```

The whole app runs warm and dark except the automap, which runs cold and light. Switching between them should feel like stepping out of the dungeon to check your map.

### Type

Three faces, each with a job that maps to a material:

| Role | Face | Used for |
|---|---|---|
| **Carved** | Cinzel | Room titles, door lintel digits, section headers. Roman engraved caps — this is stone. Used sparingly and always in caps. |
| **Voice** | Alegreya | Narration text on the floor plaque, choice labels. A warm literary serif — this is the spoken word. |
| **Paper** | Architects Daughter | Automap annotations, slugs, margin notes, the ledger. Hand-lettering — this is the surveyor's pencil. |

Type scale: 12 / 14 / 16 / 20 / 28 / 40. Narration sits at 20 for tablet legibility. Carved headers at 28 with `letter-spacing: 0.12em`.

### The signature element: torchlight

The single memorable thing in this app. A wall torch on the room's left wall, rendered as an SVG flame with a slow CSS flicker (2 keyframes, low amplitude, `prefers-reduced-motion` kills it).

- **Unlit, cold blue-grey** — node has no audio. The whole room renders dim: walls at `stone`, text at 60% opacity.
- **Lit, torch amber** — audio recorded. Room walls shift to `stone-lit`, a warm radial gradient washes from the torch position, text goes full opacity.
- **Lighting the torch is the reward for recording a node.** That transition should have a half-second flare on it.

This means walking your dungeon shows you production status without a single progress bar. Unfinished territory is literally dark.

**Restraint note:** the torch is where the boldness goes. Everything else — buttons, sheets, the ledger — stays flat, quiet, and unornamented. No stone textures on every surface, no drop shadows imitating depth, no fake 3D. Flat vector walls with one perspective trapezoid for the floor.

---

## 4. Screens

### 4.1 Room view (the core screen)

```
┌─────────────────────────────────┐
│ ◄ SHARKS_1              ⚙  🗺   │  breadcrumb / settings / map
├─────────────────────────────────┤
│ ╲                             ╱ │
│  ╲   ┌───┐   ┌───┐   ┌───┐   ╱  │  three exits: left / center / right
│ 🔥│   │ 1 │   │ 2 │   │▓3▓│  │   │  ▓ = bricked (unwritten)
│   │   └───┘   └───┘   └───┘  │   │  digit carved on lintel
│   │                          │   │
│   ╲──────────────────────────╱   │
│    ╲   THE GROANING HULL    ╱    │  Cinzel, carved into back wall
│     ╲                      ╱     │
│  ┌────────────────────────────┐  │
│  │ The hull groans. Something │  │  floor plaque, Alegreya
│  │ big is circling below.     │  │
│  └────────────────────────────┘  │
│   🎁 harpoon                     │  chest = item gained
├─────────────────────────────────┤
│  [ ✎ Edit ]  [ ● Record ]       │
└─────────────────────────────────┘
```

**Elements and what they encode:**

| Visual | Data |
|---|---|
| Archway with carved digit | A choice with `to_node_id` set. Tap to walk through. |
| Bricked arch + pickaxe icon | A choice with `to_node_id` null, or an empty slot. Tap to chisel — creates a node and enters it. |
| Spiral stairwell instead of a door | Back-edge (portal). Visually distinct so reconvergence doesn't read as branching. This is the thing your flowchart was worst at showing. |
| Back wall archway (bottom edge, swipe-right) | Parent node. Multiple parents = a fork in the retreat path, shown as a small chooser. |
| Rubble + skull, no exits | `node_type = ending` |
| Wall torch lit / unlit | `status` — recorded or not |
| Chest beside an archway | That **choice** grants an item — the chest sits at the door it belongs to |
| Chest on the floor, center | The **node** grants on arrival |
| Hole in the floor | An effect revokes something |
| Iron portcullis over an archway | Gated choice, `hide` or `refuse` |
| Archway with a false floor / trapdoor glyph | Gated choice, `divert` |
| Notch count on the portcullis | Number of conditions in the gate — a 3-condition gate looks heavier than a 1-condition gate |
| Satchel icon, top right | Tap to open the inventory inspector: every item reachable at this depth, and whether it's *guaranteed*, *possible*, or *impossible* here (§ F8.6) |
| Depth notch marks on the wall | BFS depth from root, so you know how deep a caller is |

**Movement:** tapping an archway slides the room out and the new room in, left-to-right, 250ms. Swipe right retreats. Swipe left/right on the *floor plaque* cycles between sibling nodes (same parent) without walking back up — fast for reviewing a whole choice set.

### 4.2 Editor sheet

Slides up over the room, covering ~70%. Fields, in order:

1. **Title** (carved label)
2. **Narration** — big textarea, monospace-ish, with a live character-and-estimated-seconds counter
3. **Choices** — up to 3 rows by default (expandable to 9), each with: digit selector, label text, and a destination picker (existing node search / "create new" / leave unwritten)
4. **Items** — gained / lost
5. **Node type** — room / ending / hub
6. **Timeout + invalid targets** — collapsed by default, defaults to "repeat this node"
7. **Production notes**
8. **Slug** — auto-generated from title, editable, with uniqueness check

Save is autosave-on-blur with a small "carved" confirmation, no save button.

### 4.3 The automap

Full-screen, cold blue graph paper. Rooms as hand-inked squares, corridors as pencil lines, back-edges as dashed lines. Rendered from `elkjs` layered layout, top-down by depth.

- Written rooms **inked**; stub rooms **dotted outline**
- Recorded rooms get a small filled corner triangle
- Endings drawn as a room with a heavy X through it
- Unwritten branches shown as a short stub corridor ending in a question mark
- Tap any room to teleport there in the room view
- Pinch-zoom and pan; **no dragging of nodes** — position is always derived
- Current location marked with a red pin

Bottom corner of the room view shows a 120×120 minimap thumbnail of this. Tap to expand.

### 4.4 Playtest ("Dial in")

Same data, caller's UI. Black screen, a numeric keypad, and a transcript that scrolls up as you go.

- Plays real audio where it exists; falls back to browser TTS reading the narration where it doesn't (so you can playtest before recording)
- Enforces `requires_item` gating against a live inventory chip row
- Enforces timeout: if you don't press within the node's timeout window, it takes the timeout branch
- A "path taken" log you can export as a list of slugs — useful for handing a specific route to a VO performer
- **Coverage tracking:** across playtest sessions, log which nodes have been visited. Feeds the ledger, F4.6.

### 4.5 The ledger

Graph-paper styled list view. Tabs:

| Tab | Shows |
|---|---|
| **Unexplored passages** | Choices with null destinations — your to-write list |
| **Sealed rooms** | Orphan nodes with no inbound choices |
| **Dark rooms** | Nodes with no audio, sorted by depth so you record from the entrance outward |
| **All rooms** | Sortable/filterable table — closest thing to your old spreadsheet, kept deliberately |
| **Items** | Every item mentioned, where it's gained, where it's lost, where it's required. Catches "requires harpoon but harpoon is never obtainable." |

### 4.6 Export

One screen, three buttons:

1. **Twilio Studio flow JSON** — the payoff. See §6.
2. **Audio manifest** — CSV of slug → filename → status → duration, for tracking VO sessions
3. **Story JSON** — full backup / import, so the whole thing round-trips

---

## 5. Feature breakdown

Numbered so you can cut, reorder, or add. Priority: **P0** = the app is pointless without it, **P1** = makes it genuinely good, **P2** = nice to have.

### F1 — Room view
| # | Feature | Pri |
|---|---|---|
| F1.1 | Render node as room with up to 3 wall exits | P0 |
| F1.2 | Tap archway to walk to child node | P0 |
| F1.3 | Tap bricked arch to create child node inline | P0 |
| F1.4 | Swipe right / back-wall tap to retreat to parent | P0 |
| F1.5 | Torch lit/unlit driven by audio status, with room lighting shift | P1 |
| F1.6 | Portal (back-edge) rendered as stairwell, not door | P1 |
| F1.7 | Chest / floor-hole for item gained / lost | P1 |
| F1.8 | Iron gate on gated choices | P2 |
| F1.9 | Rubble + skull for endings | P1 |
| F1.10 | Depth notches on wall | P2 |
| F1.11 | Sibling cycling by swiping the floor plaque | P2 |
| F1.12 | Multi-parent retreat chooser | P1 |
| F1.13 | Expand beyond 3 exits (4–9 digits) — renders as a stacked list rather than walls | P2 |

### F2 — Authoring
| # | Feature | Pri |
|---|---|---|
| F2.1 | Editor sheet with all node fields | P0 |
| F2.2 | Autosave on blur | P0 |
| F2.3 | Slug auto-generation with uniqueness check | P0 |
| F2.4 | Destination picker: search existing nodes, create new, or leave unwritten | P0 |
| F2.5 | Digit collision prevention | P0 |
| F2.6 | Convert node type (room ↔ ending ↔ hub) with warning if it orphans children | P1 |
| F2.7 | Estimated spoken duration from word count, warn over 15s | P1 |
| F2.8 | Duplicate a room and its subtree | P2 |
| F2.9 | Global find & replace across narration | P2 |
| F2.10 | Undo stack, last 20 actions | P1 |

### F3 — Audio
| # | Feature | Pri |
|---|---|---|
| F3.1 | Hold-to-record scratch VO via `MediaRecorder` | P0 |
| F3.2 | Inline playback with waveform scrubber | P1 |
| F3.3 | Upload a finished file to replace scratch | P0 |
| F3.4 | Auto-advance status stub → scripted → recorded on save/record | P1 |
| F3.5 | "Approved" flag, manually set, distinct from "recorded" | P1 |
| F3.6 | Reusable clips — one audio file referenced by several nodes | P2 |
| F3.7 | Batch record mode: queue all dark rooms, record them back to back | P2 |
| F3.8 | Trim head/tail silence in-browser | P2 |

### F4 — Structure & validation
| # | Feature | Pri |
|---|---|---|
| F4.1 | Automap with derived layout | P1 |
| F4.2 | Minimap thumbnail in room view | P2 |
| F4.3 | Ledger: unwritten branches | P0 |
| F4.4 | Ledger: orphan nodes | P1 |
| F4.5 | Ledger: unrecorded nodes by depth | P1 |
| F4.6 | Playtest coverage tracking | P2 |
| F4.7 | Item consistency check | P1 |
| F4.8 | Unreachable-node detection (BFS from root) | P1 |
| F4.9 | Infinite-loop warning: a cycle with no exit | P2 |
| F4.10 | Full-text search + teleport | P0 |

### F5 — Playtest
| # | Feature | Pri |
|---|---|---|
| F5.1 | Keypad UI with audio playback | P0 |
| F5.2 | TTS fallback for unrecorded nodes | P1 |
| F5.3 | Live inventory display | P1 |
| F5.4 | Timeout enforcement | P2 |
| F5.5 | Item gating enforcement | P1 |
| F5.6 | Exportable path log | P2 |
| F5.7 | Random walk — auto-play random choices to smoke-test for crashes | P2 |

### F6 — Export
| # | Feature | Pri |
|---|---|---|
| F6.1 | Twilio Studio flow JSON | P0 |
| F6.2 | Audio manifest CSV | P1 |
| F6.3 | Story JSON backup/restore | P0 |
| F6.4 | Automap PNG/SVG export | P2 |
| F6.5 | Printable script — full narration doc for VO talent, one node per section | P1 |

### F8 — Items & state
| # | Feature | Pri |
|---|---|---|
| F8.1 | State var registry: create items, flags, counters with slug + spoken name | P0 |
| F8.2 | Attach effects to a **choice** (grant / revoke / set / add) | P0 |
| F8.3 | Attach effects to a **node** (fires on arrival) | P1 |
| F8.4 | Visual gate builder — tap to add conditions, AND/OR/NOT toggles, no typing expressions | P0 |
| F8.5 | Three fail behaviors with per-gate narration | P1 |
| F8.6 | **Reachability solver** — for any node, compute which items are *guaranteed*, *possible*, or *impossible* to hold on arrival | P1 |
| F8.7 | **Softlock detection** — find gates no path can satisfy, and consumable items spent before a later gate needs them | P1 |
| F8.8 | Orphan item check: items granted but never required, or required but never granted | P1 |
| F8.9 | Consumable handling — auto-revoke on gate pass | P2 |
| F8.10 | Item timeline view: for one item, every grant site, revoke site, and gate that tests it | P2 |
| F8.11 | Spoken inventory readback — a `*` key that reads the caller's items aloud | P2 |
| F8.12 | Playtest inventory override — force-set state to test a late-game gate without replaying the whole story | P1 |

F8.6 and F8.7 are the ones that actually earn their keep. A branching story with items develops bugs a human can't see: a gate at depth 12 that requires an item only obtainable on a path that can't reach depth 12. The solver walks every path and tells you. This is the single strongest argument for building the app instead of using a flowchart.

### F7 — Platform
| # | Feature | Pri |
|---|---|---|
| F7.1 | Supabase persistence + magic link auth | P0 |
| F7.2 | PWA install, works fullscreen on tablet | P1 |
| F7.3 | Multi-story support | P1 |
| F7.4 | Offline write queue via IndexedDB | P2 |
| F7.5 | Read-only share link for collaborators | P2 |
| F7.6 | `prefers-reduced-motion` disables flicker and slide transitions | P0 |

---

## 6. Twilio Studio compilation

### 6.0 The constraints that shape everything

From Twilio's Studio docs, confirmed:

| Limit | Value | What it means for you |
|---|---|---|
| Total widgets | <cite index="4-15">2,000 across the parent flow and all linked subflow instances, with more available by contacting Support</cite> | This is your real budget. See §6.5. |
| Steps per execution | <cite index="4-13">Execution ends after 1,000 steps</cite> | Caps how long a single call can run, not how big the story is. |
| Repeat guard | <cite index="4-16">Studio stops executing if the same widget runs 10 times in a row</cite> | Tight self-loops break. Hub nodes need care. |
| Subflow widgets | <cite index="6-9">Up to 150 Run Subflow widgets referencing up to 50 unique subflow definitions</cite> | Plenty for act-level chunking. |
| Subflow nesting | <cite index="6-12">Only one level — subflows can't call other subflows</cite> | Acts can be subflows; scenes inside them can't. |
| Subflow data | <cite index="6-13">Only simple values can be passed in and out</cite> | **Kills the idea of a JSON inventory object.** Drives the design in §6.1. |
| Liquid strings | <cite index="3-11">Render up to 16 KB</cite> | Inventory string will never come close. |

### 6.1 Encoding inventory

One flow variable, `inv`, holding a pipe-delimited string:

```
|HARPOON|LANTERN|TRUSTED_CAPTAIN|
```

Counters get their own variables: `c_ROPE_LENGTH`.

**Why delimited string over one boolean per item:** subflows only accept simple values, so a JSON object can't cross a subflow boundary. One string can. It also means a single Set Variables widget carries the whole inventory instead of one per item.

**Why the leading and trailing pipes matter:** <cite index="4-25">Studio's Contains predicate matches substrings — `aab` contains `aa`</cite>. Without delimiters, testing for `ROPE` would falsely match `ROPEBURN`. Testing for `|ROPE|` can't. The exporter must always wrap both the stored values and the test values in pipes. This is the kind of bug that surfaces three weeks into recording, so it's worth a unit test.

**Grant** — one Set Variables widget, key `inv`, Liquid value:

```liquid
{% assign cur = flow.variables.inv | default: "|" %}
{% if cur contains "|HARPOON|" %}{{ cur }}{% else %}{{ cur }}HARPOON|{% endif %}
```

**Revoke:**

```liquid
{{ flow.variables.inv | replace: "|HARPOON|", "|" }}
```

**Counter add:**

```liquid
{{ flow.variables.c_ROPE_LENGTH | default: 0 | plus: 3 }}
```

<cite index="2-11">A single Set Variables widget can define multiple key/value pairs</cite>, so all effects on one choice compile into **one** widget regardless of how many items change.

### 6.2 Where effects go in the flow

This is the ordering question, and it has one right answer.

A choice's effects must fire **after** the gather resolves that digit and **before** the destination node plays. So the compiled shape is:

```
[NODE_play] → [NODE_gather] ─digit 1→ [CHOICE_1_effects] → [TARGET_play]
                             ─digit 2→ [CHOICE_2_effects] → [TARGET_play]
                             ─timeout→ [NODE_play]  (repeat)
```

Node-level effects go **before** that node's play widget, so narration can reference the item it just granted.

If a choice has no effects, the exporter emits no widget and wires the gather transition straight to the target. Don't pay widgets for nothing.

### 6.3 Compiling gates

Studio's Split Based On tests **one variable against a list of conditions**, and <cite index="1-11">conditions produce separate transitions — Condition Matches and No Match</cite>. Those conditions are alternatives, not a conjunction. So there's no native way to express "has harpoon AND lacks wound AND rope ≥ 3" in a single split.

**The solution: precompute the whole boolean in Liquid, split on the result.** Arbitrary gate logic collapses to exactly two widgets:

```liquid
{% assign inv = flow.variables.inv | default: "|" %}
{% assign rope = flow.variables.c_ROPE_LENGTH | default: 0 %}
{% if inv contains "|HARPOON|" and inv contains "|WOUNDED|" == false and rope >= 3 %}pass{% else %}fail{% endif %}
```

Stored to `gate_SHARKS_1_d2`, then a Split Based On tests that variable for `Equal To` `pass`.

**Batching:** all gates on a single node compile into **one** Set Variables widget with multiple keys, so a node with three gated choices costs 1 set-variables + 3 splits, not 6 widgets.

**Placement per fail behavior:**

| Behavior | Compiled shape |
|---|---|
| `hide` | Gate evaluated **before** the node's play widget. The narration itself is Liquid-conditional, so the ungated line simply isn't spoken. Costs 0 extra splits — the gather just never receives that digit. Cheapest option. |
| `refuse` | Gate split sits after the gather on that digit. Fail → a small say widget with `fail_narration` → back to `NODE_gather` (not `NODE_play`, so the caller doesn't re-hear the whole scene). |
| `divert` | Gate split after the gather. Fail → `fail_node_id`'s play widget. |

Note the `refuse` path loops back to the gather widget. <cite index="4-16">Studio kills an execution if a widget runs 10 times in a row</cite>, so a caller mashing a locked door ten times gets hung up on. The exporter should route the 8th failure to an escape node instead. The app can generate that automatically — call it a "patience valve."

### 6.4 Subflows, and the gotcha that will bite you

For act-level chunking, the app should propose subflow boundaries by finding **dominator subtrees** — subgraphs with exactly one entry point and no inbound edges from outside. Those are the only clean cut points. The app can compute them and rank them by size.

**The gotcha:** <cite index="5-4,5-5">variables set inside a subflow are not present in `flow.variables` after returning — they're accessed from the Run Subflow widget's namespace instead, as `{{widgets.subflow_widget.foo}}`</cite>.

So if the caller picks up the harpoon inside a subflow, **that change is silently lost when the subflow returns** unless you copy it back. Every Run Subflow widget the exporter emits must be immediately followed by:

```
Set Variables:  inv = {{widgets.subflow_act2.inv}}
```

And the subflow itself must end with a Set Variables that exposes `inv`. Miss either half and you get a bug that only appears on paths crossing an act boundary — nearly impossible to find by playtesting.

**The app should generate both halves automatically and refuse to export a subflow-partitioned build without them.** If subflows feel like too much rope, the alternative is a single flat flow, which is fine up to the widget ceiling.

### 6.5 The widget budget meter

A live readout in the app, because the ceiling is real and you should know where you stand while writing, not at export time.

| Element | Widgets |
|---|---|
| Node (room) | 2 — say/play + gather |
| Node (ending) | 2 — say/play + hangup |
| Node with arrival effects | +1 |
| Node with any `hide` gates | +1 (batched) |
| Node with `refuse`/`divert` gates | +1 batched eval, +1 split per gated choice, +1 say per `refuse` |
| Choice with effects | +1 |
| Run Subflow boundary | +2 (the subflow call + the inventory copy-back) |

Rough shape: a 200-node story with moderate item use lands somewhere near 550–650 widgets — comfortable. The meter should show a bar against 2,000 with a projection based on your current items-per-node average, and warn at 80%.

**Separately, a step-depth check.** The 1,000-step execution cap applies to a single call, not the whole story. The app should compute the longest simple path in steps — roughly 3–4 per node once gates and effects are counted — and flag any route that could exhaust it. A 250-node single playthrough is where this starts to matter.

### 6.6 How the app tells you to arrange it

Three outputs, depending on how you want to build:

**A. Flow definition JSON (automatic).** Widget graph plus `x`/`y` coordinates from the same `elkjs` layout that drives the automap, so the imported flow lands readable instead of piled in a corner. Layered top-down by story depth, one column per act. Verify your account can import a flow definition before committing to this path — if not, fall back to B or C.

**B. The build sheet (manual construction).** A printable, ordered checklist for building it by hand in the Studio canvas. One section per node, in dependency order so you never have to wire a transition to a widget that doesn't exist yet:

```
─── SHARKS_1  (room, depth 4) ────────────────────
 1. Say/Play        SHARKS_1_play
      Play URL: https://dabingabongo.com/audio/sharks-1.mp3
      → next: SHARKS_1_gates

 2. Set Variables   SHARKS_1_gates
      gate_SHARKS_1_d2 = {% assign inv = ... %}   [copy button]
      → next: SHARKS_1_gather

 3. Gather          SHARKS_1_gather
      Stop gathering after: 1 digit
      → "1"      : SHARKS_1_d1_fx
      → "2"      : SHARKS_1_d2_gate
      → timeout  : SHARKS_1_play
      → no match : INVALID_PROMPT
 ...
```

Every Liquid block gets a copy-to-clipboard button. This is the pragmatic path — Studio's canvas is fine to build in once you know exactly what to place.

**C. Flows REST API push.** Skip the canvas entirely and POST the flow definition. Best long-term if you're iterating often; the app holds the source of truth and Studio becomes a build target.

**Recommendation:** build B first — it's a pure rendering of data you already have and it unblocks you immediately. A and C are the same JSON generator with different delivery, so once B is right they're cheap.

### 6.7 Mapping reference

Studio flows are JSON with a `states` array. Each of your nodes compiles to two widgets:

1. A `say-play` widget — `<Play>` the audio URL if `audio_path` exists, otherwise `<Say>` the narration
2. A `gather-input-on-call` widget — one transition per choice digit, plus `timeout` and `no-match` transitions

**Mapping rules:**

| App concept | Studio output |
|---|---|
| `node.slug` | widget name prefix — `SHARKS_1_play`, `SHARKS_1_gather` |
| `choice.digit` | gather transition condition on `Digits` |
| `choice.to_node_id` | transition `next` → target node's play widget |
| `node.timeout_target_id` | gather `timeout` transition |
| `node.invalid_target_id` | gather `no-match` transition |
| `node_type = ending` | play widget → hangup widget |
| Node effects | `set-variables` widget **before** the play widget |
| Choice effects | `set-variables` widget on that gather transition, before the target |
| `gates` | one batched `set-variables` eval + one `split-based-on` per gated choice |
| `fail_behavior = refuse` | say widget → back to the **gather**, with a patience valve at 8 attempts |
| Subflow boundary | `run-subflow` + mandatory `set-variables` inventory copy-back |

---

## 7. The state solver (10–20 vars)

At this size, brute-forcing every path is out — but the state space is far smaller than it looks, because most inventory combinations are never actually reachable.

**Representation.** Items and flags become bit positions in a 32-bit integer. 20 vars fits comfortably in one int, and set operations become single CPU instructions. Counters are separate and **must be clamped** — pick a max per counter (say 10) and saturate there, or the state space is infinite and the solver never terminates.

**Algorithm.** Fixed-point worklist iteration:

1. Every node holds a `Set<bitmask>` of inventory states the caller could arrive with. Start: root = `{0}`.
2. Pop a node from the worklist. For each outgoing choice: filter its arrival states by the gate expression, apply the choice's effects to each surviving mask, and union the results into the destination's set.
3. If a destination's set grew, push it back on the worklist.
4. Repeat until nothing changes.

Cycles are handled for free — the set stops growing, so iteration halts.

**What falls out of it:**

| Question | Answer |
|---|---|
| Is item X guaranteed here? | Bit set in **every** mask in the node's set |
| Is item X possible here? | Bit set in **any** mask |
| Is this gate ever satisfiable? | No mask in the source node's set passes the expression → **dead gate**, flag it |
| Is this node reachable at all? | Its set is empty |
| Can a consumable be spent too early? | A path grants it, spends it at gate A, and later hits gate B needing it with no re-grant |

**Performance.** Run it in a Web Worker, debounced ~400ms after edits, so the UI never blocks. For a few hundred nodes and 20 vars this should land well under a second. Cache per-node results and only re-run the subtree downstream of the edited node.

**Show the result in the room view.** The satchel icon opens a panel: guaranteed items in torch amber, possible items dimmed, impossible items struck through. That's the payoff — you see the player's realistic state while writing the room, not after.

---

## 8. Importing your existing story

**Recommendation: import the spreadsheet, not the flowchart JSON.** The sheet has more real data — dialogue, item received/lost, recorded status — where the React Flow export is mostly labels and canvas positions you no longer need.

**How hard it is, honestly:** the mapping is close to 1:1, so the parser is maybe an hour or two. The friction is in three places:

| Sheet column | Maps to | Friction |
|---|---|---|
| Node name | `nodes.slug` | Clean, you already use `SHARKS_1` |
| Node type | `nodes.node_type` | May need vocabulary remapping |
| Dialogue | `nodes.narration` | Clean |
| Comes from | *(derived)* | Ignore on import — inbound edges are computed |
| Leads to | `choices` | **Comma-separated names with no digits.** Importer assigns 1, 2, 3 in listed order; you verify. |
| Item received / lost | `effects` | **Sheet stores these on the node; the new model wants most on the choice.** Import as node-level, then walk them. |
| Recorded | `nodes.status` | Clean |

So it gets you ~90% there and leaves an item-placement pass — which the app makes fast, since you're just walking rooms and dragging chests from the floor to the correct door.

**The decision rule:** if the sheet has more than about 30 filled rows, import wins clearly. Under that, retyping while you learn the app is fine and probably better.

**Build it as F2.11, in Phase 1**, with a preview screen showing what will be created and which rows failed to parse. Never write directly from a CSV without a review step.

---

## 9. Collaboration

A small group changes the platform layer more than the story layer.

### `memberships`
| Column | Type | Notes |
|---|---|---|
| `story_id` / `user_id` | uuid FK | |
| `role` | enum | `owner` \| `writer` \| `voice` \| `viewer` |

`voice` is worth having as its own role: someone who records audio and marks status but shouldn't restructure the story. Postgres RLS enforces it — writers can update `nodes`/`choices`/`effects`, voice can only update `audio_path` and `status`.

### F9 — Collaboration
| # | Feature | Pri |
|---|---|---|
| F9.1 | Memberships + roles with RLS enforcement | P0 |
| F9.2 | Invite by email / magic link | P0 |
| F9.3 | Comments thread per node | P1 |
| F9.4 | **Claiming** — claim an unwritten branch or a dark room so two people don't do the same work | P1 |
| F9.5 | Soft edit locks via Supabase Realtime — "Dan is in this room" banner | P1 |
| F9.6 | Change log: who changed what, when, with revert | P2 |
| F9.7 | Read-only share link for people outside the group | P2 |
| F9.8 | Per-person ledger filter: "my claimed rooms" | P2 |

**F9.4 is the one that matters.** With a group, the ledger stops being a to-do list and becomes a work queue. Claiming an unexplored passage means someone else's app greys it out. This is the difference between three people collaborating and three people colliding.

Skip full real-time co-editing. Last-write-wins on autosave plus soft locks is enough for a group this size, and operational transforms are a large build for a small payoff here.

---

## 10. Build phases

**Phase 1 — Skeleton walker + import.** Schema, auth, memberships/RLS, node/choice CRUD, unstyled room view, walk and create. Plus the CSV importer with preview (F2.11). *Done when your existing story is in the app and navigable by tapping.*

**Phase 2 — Dungeon dressing.** Tokens, typefaces, wall/floor/archway SVGs, the torch, transitions, endings, portals.

**Phase 3 — Audio.** Record, playback, upload, status flow, torch lighting.

**Phase 4 — Structure.** Automap, minimap, ledger tabs, structural validation, search.

**Phase 4.5 — Items & state.** State var registry, choice-level effects, gate builder, fail behaviors, then the Web Worker solver from §7.

**Phase 5 — Playtest.** Keypad, TTS fallback, live inventory, gate enforcement, state override.

**Phase 5.5 — Collaboration.** Comments, claiming, soft locks. *Deliberately after playtest — get it good solo before inviting people in.*

**Phase 6 — Export.** Build sheet first, then Studio JSON, manifest, printable script.

**Phase 7 — Polish.** PWA, offline queue, reduced motion, phone responsive.

---

## 11. Remaining decisions

Settled: 10–20 state vars, spreadsheet import, small group with roles.

Still open, with the moment each actually needs answering:

1. **Exits per room** — three fits the walls and good IVR practice. Decide when you hit a node genuinely needing a fourth; treat that as a smell first. *Needed: Phase 2.*
2. **Flat flow vs. subflows** — stay flat. The widget budget meter tells you when to revisit. *Needed: Phase 6.*
3. **Default gate fail behavior** — `refuse` sounds best, `hide` is cheapest in widgets. Changeable any time. *Needed: Phase 4.5.*
4. **Pixel art vs. flat vector** — spec assumes vector; sprites could swap in later without touching logic. *Needed: Phase 2.*
5. **Counter clamp ceiling** — pick a max per counter so the solver terminates. *Needed: Phase 4.5.*
