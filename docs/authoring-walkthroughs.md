# Authoring walkthroughs

Every routine job in this app, written out tap by tap, so the awkward ones are
visible as counts rather than as a feeling.

Counts are of taps the interface actually requires, measured at **430 px wide**
(the phone, which is the second target device after tablet portrait). Where a
step writes to the database it could not be completed against the demo story,
which has no database; those steps are marked *(unmeasured)* and counted from
the controls that exist.

The point of the exercise is the **Findings** section at the end. The
walkthroughs are the evidence.

---

## 1. Walk somewhere and read it

> Open the story · walk two rooms · read the script

| # | Tap | Surface |
|---|---|---|
| 1 | Archway | room |
| 2 | Archway | room |

**2 taps.** Nothing to improve. This is the thing the app is for and it costs
nothing.

---

## 2. Chisel a new room off a blank arch

| # | Tap | Surface |
|---|---|---|
| 1 | the bricked arch | room |
| 2–3 | name it in the header, write the narration | room / editor |

**1 tap to the new room.** Also fine. The blank arch is the best control in
the app: one tap, and you are standing in the thing you just made.

---

## 3. Point a door back at a room that exists

| # | Tap | Surface |
|---|---|---|
| 1 | Show where doors lead | room |
| 2 | "↺ send it back to a room that exists" | room |
| 3 | the room, from *The way you came* | picker |

**3 taps, one surface.** Good. The picker leads with the rooms you actually
want, so step 3 is a tap and not a search.

---

## 4. Fork a door on an item — from a story with no items yet

Measured live.

| # | Tap | Surface |
|---|---|---|
| 1 | Show where doors lead | room |
| 2 | ⑂ on the door | room |
| 3 | **Done** — dead end, the sheet says "Create an item first, on the Items tab" | fork sheet |
| 4 | ✎ EDIT | room |
| 5 | tick "🎒 An item changes hands" — *the Items tab does not exist until now* | editor → Write |
| 6 | type the item name | editor → Items |
| 7 | + New *(unmeasured)* | editor → Items |
| 8 | Done | editor |
| 9 | ⑂ on the door, again | room |
| 10 | ⑂ Make this door fork on an item | fork sheet |
| 11 | pick the other room | picker |

**~11 taps across three surfaces, with a dead end at step 3.**

The dead end is the whole problem. The fork sheet knows there are no items, and
sends you somewhere you cannot get to from where you are standing — the Items
tab is itself hidden behind a checkbox on a different tab.

---

## 5. Hide a door from callers without an item

There are **two ways to do this**, they produce the same visible result, and
they are stored differently.

### A — through the state plate (needs the room to have a reading)

| # | Tap | Surface |
|---|---|---|
| 1 | the state plate | room |
| 2 | "As written" | plate menu |
| 3 | Show where doors lead | room |
| 4 | untick **here** on the door | room |

**4 taps, one surface, the editor never opens.** This is the good path.

### B — through a `hide` gate (works in any room)

| # | Tap | Surface |
|---|---|---|
| 1 | ✎ EDIT | room |
| 2 | tick "🎒 An item changes hands" | editor → Write |
| 3 | Items | editor |
| 4 | scroll to the door | editor → Items |
| 5 | + Require something | editor → Items |
| 6 | choose the item | editor → Items |
| 7 | change "say why, and stay here" → "don't offer the choice at all" | editor → Items |
| 8 | Done | editor |

**~8 taps, and a different data model.** But path A is unavailable unless the
room already has a reading, and nothing tells you that — the export warns
*afterwards* if you write a visibility rule in a room with no readings.

---

## 6. Two doors on one key, one per state

| # | Tap | Surface |
|---|---|---|
| 1 | state plate → the state the second door belongs to | room |
| 2 | the blank arch on that key | room |
| 3–4 | name the new room, label the door | room |

**~4 taps**, and the app quietly does the hard part: the new door is hidden in
every other state, because those already have their answer for that key.

The catch is that this only works if the key is *free in that state*, which
means you must already have hidden the other door there. Nothing suggests the
order.

---

## 7. Record a room

| # | Tap | Surface |
|---|---|---|
| 1 | ✎ EDIT | room |
| 2 | Sound | editor |
| 3 | hold the record button | editor → Sound |

**3 taps.** Or `Record` in the nav for the whole queue in story order, which is
the right tool for a session and correctly separate.

---

## 8. Give a door an item, and require it at another

| # | Tap | Surface |
|---|---|---|
| 1–3 | EDIT → tick items → Items | editor |
| 4–5 | pick the door, "+ add an effect…" → the item | editor → Items |
| 6 | Done | editor |
| … | walk to the other room | room |
| 7–12 | the same six taps again, then + Require something | editor → Items |

**~12 taps across two rooms.** The second half is unavoidable — it is two
separate pieces of writing. Steps 2 and 3 are not: ticking a box to reveal a
tab, twice, for a story that already has items.

---

## 9. Get it into Twilio

| # | Tap | Surface |
|---|---|---|
| 1 | Export | nav |
| 2 | read the warnings | export |
| 3 | copy the flow JSON | export |
| 4 | paste into Studio → Import from JSON | Twilio |

**4 taps.** Fine.

---

# Findings

Ordered by how much time they cost.

### 1. Item logic is behind a checkbox, and the checkbox is on another tab

The Items tab does not exist until "🎒 An item changes hands" is ticked in
Write. Every item flow therefore starts with two taps that do nothing except
reveal the place you were already trying to reach — and the fork sheet, which
knows perfectly well that no items exist, dead-ends into it.

**Costs:** 2 taps on every item flow, and one dead end (walkthrough 4, step 3).

**Fix:** show the Items tab whenever the *story* has any state vars, not when
the room does. Add "+ Create an item" directly to the fork sheet and the gate
builder, so neither ever dead-ends.

### 2. Two mechanisms for "this door isn't offered"

`hide` gates and `hidden_doors` (walkthrough 5) look identical to an author and
are stored differently. One is 4 taps and one is 8. The 4-tap one silently
requires the room to have a reading. Nothing warns when both are set on one
door.

**Fix:** one control on the door — *Offered: always / only in these states /
only when ⟨condition⟩* — writing whichever mechanism fits the answer.

### 3. Neither door surface is complete

| | room panel | editor → Doors |
|---|---|---|
| label | ✓ | ✓ *(the only duplicate)* |
| name of the room behind | ✓ | — |
| fork ⑂ | ✓ | — |
| reaction 🔊 | ✓ | — |
| which digit | — | ✓ |
| where it leads | — | ✓ |
| insert a room ⤵ | — | ✓ |
| delete | — | ✓ |

Half the controls in each place, so every door job is a guess about which
surface to open.

**Fix:** move digit / destination / insert / delete onto the room panel and let
the editor's Doors tab become the overview it already looks like.

### 4. Order-of-operations traps

Three jobs only work if you do them in an undocumented order:

- a fork needs the door pointed somewhere *before* it can fork (the sheet says
  so, but only after you open it);
- a second door on a key needs the first one hidden in that state *first*;
- a visibility rule needs the room to have a reading *first*.

**Fix:** each of these already knows why it is unavailable. Say it on the
control rather than in the sheet behind it.

### 5. The doors panel is dense at 430 px

Three doors is 6 icon buttons (⑂ 🔊 each) plus the label and room-name fields,
before the digit, the "here" box and the fork target text. Measured: 14 visible
buttons with the panel open, 29 with the editor open on top of it.

**Fix:** collapse ⑂ and 🔊 into one "…" per door, or show them only for doors
that have something.

### 6. Dead weight in the code

- `hasSharedKeys` — written, never called.
- `gateConditionLiquid` — superseded by `gateAssignmentLiquid`.
- `RoomView.readingText` — computed for every room, consumed by nothing since
  the reading's words moved into `lines`.
- `_shown` and `_pick` in the exporter are two splits on the same variable;
  `_pick` ("which door is this") already subsumes `_shown` ("is this door
  here"), where no door is the noMatch.

### 7. `compile.ts` is 1,249 lines

The per-choice loop is ~250 of them and shares little with room emission.
Splitting them would make the next export change safer — and there has been an
export change in nearly every round of work.
