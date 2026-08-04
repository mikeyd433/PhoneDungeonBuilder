# Authoring walkthroughs

Every routine job in this app, written out tap by tap, so the awkward ones are
visible as counts rather than as a feeling.

Counts are of taps the interface actually requires, measured at **430 px wide**
(the phone, which is the second target device after tablet portrait) by driving
the real UI. Where a step writes to the database it could not be completed
against the demo story, which has no database; those steps are counted from the
controls that exist and marked *(write unmeasured)*.

Every number below was **re-measured after the last round of fixes**, and two of
them had drifted from what the fixes claimed — see the note under walkthrough 4.
The point of the exercise is the **Findings** section at the end. The
walkthroughs are the evidence.

> Since finding 12, the doors panel **starts open**, so every job that begins at
> a door is one tap shorter than the tables below say. The counts are kept as
> measured and the saving is noted per flow, because a number that quietly
> improved is still a number nobody re-measured.

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
| 1 | ~~Show where doors lead~~ — already open | room |
| 2 | "↺ send it back to a room that exists" | room |
| 3 | the room, from *The way you came* | picker |

**2 taps** in the middle of a story (3 before the panel opened by default).
**3 at the entrance**, where there is no
way you came and the room has to be found by typing — which is correct, not a
defect: the picker has nothing better to lead with there.

---

## 4. Fork a door on an item

### Before

| # | Tap | Surface |
|---|---|---|
| 1 | Show where doors lead | room |
| 2 | ⑂ on the door | room |
| 3 | **Done** — dead end, "Create an item first, on the Items tab" | fork sheet |
| 4 | ✎ EDIT | room |
| 5 | tick "🎒 An item changes hands" — *the Items tab did not exist until now* | editor → Write |
| 6–7 | type the item name, + New | editor → Items |
| 8 | Done | editor |
| 9–10 | ⑂ again, Make this door fork | room / fork sheet |
| 11 | pick the other room — *and only a room that already existed* | picker |

**~11 taps, three surfaces, dead end at step 3.**

### Now — measured, not estimated

| # | Tap | Surface |
|---|---|---|
| 1 | ~~Show where doors lead~~ — already open | room |
| 2 | ⋯ on the door | room |
| 3 | Where it leads | door sheet |
| 4 | ⑂ Make this door fork on an item *(write unmeasured)* | fork sheet |
| 5 | the other route → **⛏ Cut a new room called "…"** | picker |

**3 taps to a fork, 4 to a fork whose second room did not exist** — one less
than the 4 and 5 measured before the panel opened by default. With no items
in the story at all it is **6**: step 4 becomes "+ Create the first item", the
name, and Add — which creates the item *and* writes the fork in one go.

> **Correction.** The previous version of this file said "3 taps with an item in
> the story, ~4 without". That was written from the plan, not the screen. The
> door sheet — the right fix for finding 3 — added a layer between the panel and
> the fork, so the true numbers are 4 and 6. Both are still less than half of
> what they were, and the dead end is gone; but a count nobody re-measured after
> the change is exactly the kind of claim this document exists to prevent.

---

## 5. Hide a door from callers without an item

There are **two ways to do this**, they produce the same visible result, and
they are stored differently.

### Before — two paths, 4 taps and 8, different storage

**A, through the state plate** (needs the room to have a reading): plate → the
state → Show where doors lead → untick **here**. Four taps. *(Both the plate
and this mechanism are gone — findings 10 and 11.)*

**B, through a `hide` gate** (works anywhere): EDIT → tick "an item changes
hands" → Items → find the door → + Require something → choose the item →
change "say why" to "don't offer the choice at all" → Done. Eight taps.

Same visible result. Nothing said which was which, or warned when both were set
on one door.

### Now — one question

| # | Tap | Surface |
|---|---|---|
| 1 | ~~Show where doors lead~~ — already open | room |
| 2 | ⋯ on the door | room |
| 3 | When it is offered | door sheet |
| 4 | Always · Only when carrying something | offered sheet |

**3 taps**, one question, one mechanism — the `hidden_doors` half went with the
readings (finding 11). What a hide gate cannot do is *announce* the door, and
the sheet says so, naming the thing that can: a fork on the door in.

---

## 6. Walk both halves of a fork

| # | Tap | Surface |
|---|---|---|
| 1 | the archway of the forking door | room |
| 2 | **Walk into ⟨room⟩**, under the condition it belongs to | fork modal |

**2 taps to either room** — the same as walking through an ordinary door, which
is what it should cost. Before this the fail route could not be walked into at
all: the archway always took the pass route, so the second room was reachable
only by going out to the map and teleporting in.

The modal wires a route that leads nowhere yet, through the same picker the
fork sheet uses, so a half-built fork is finished where you found it.

---

## 7. Record a room

| # | Tap | Surface |
|---|---|---|
| 1 | ✎ EDIT | room |
| 2 | Sound | editor |
| … | hold the record button | editor → Sound |

**2 taps and a hold.** Or `Record` in the nav for the whole queue in story
order, which is the right tool for a session and correctly separate.

---

## 8. Give a door an item, and require it at another

### Before

| # | Tap | Surface |
|---|---|---|
| 1–3 | EDIT → tick items → Items | editor |
| 4–5 | pick the door, "+ add an effect…" → the item | editor → Items |
| 6 | Done | editor |
| … | walk to the other room | room |
| 7–12 | the same six taps again, then + Require something | editor → Items |

**~12 taps across two rooms.**

### Now

| # | Tap | Surface |
|---|---|---|
| 1 | ~~Show where doors lead~~ — already open | room |
| 2 | ⋯ on the door | room |
| 3 | the item, from "+ add an effect…" *(write unmeasured)* | door sheet |

**2 taps**, and neither leaves the door. **3 with no items in the story** —
"+ New item" sits beside the same select, so the last dead end on the item path
is closed too.

Requiring it at the far door is still its own job (EDIT → Items → + Require
something → the item, **4 taps**), because the Items tab is the whole room at
once and a requirement usually wants to be read next to its neighbours. Across
two rooms: **7 taps**, down from ~12.

---

## 9. Reach the Items tab at all

| # | Tap | Surface |
|---|---|---|
| 1 | ✎ EDIT | room |
| 2 | Items | editor |

**2 taps**, down from 3 — the tab used to require ticking a box on another tab
first, which is finding 1 below.

---

## 10. Get it into Twilio

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

### 1. Item logic is behind a checkbox, and the checkbox is on another tab — **done**

The Items tab did not exist until "🎒 An item changes hands" was ticked in
Write. Every item flow therefore started with two taps that did nothing except
reveal the place you were already trying to reach — and the fork sheet, which
knew perfectly well that no items existed, dead-ended into it.

**Fixed:** the Items tab shows whenever the *story* has any state vars, and
"+ Create an item" sits in the fork sheet, the gate builder and the effects
list, so none of them can dead-end. Walkthrough 9 is now 2 taps.

### 2. Two mechanisms for "this door isn't offered" — **done**

`hide` gates and `hidden_doors` (walkthrough 5) look identical to an author and
are stored differently. One was 4 taps and one was 8. The 4-tap one silently
required the room to have a reading. Nothing warned when both were set.

**Fixed:** one control on the door — *Offered: always / only in these states /
only when ⟨condition⟩* — writing whichever mechanism fits the answer.

### 3. Neither door surface is complete — **done**

Half the controls in each of the room panel and the editor's Doors tab, so every
door job began with a guess about which screen to open.

**Fixed:** one `⋯` per door opens a sheet holding the digit, the label, where it
leads, what it gives or takes, when it is offered, what is heard on the way
through, insert and remove. The editor's Doors tab stays as the
all-doors-at-once view.

### 4. Order-of-operations traps — **done**

Three jobs only worked in an undocumented order: a fork needed the door pointed
somewhere first, a second door on a key needed the first hidden in that state
first, a visibility rule needed the room to have a reading first.

**Fixed**, each as an action rather than an explanation — "Point this door at a
room →" and "+ Give this room a second reading". The second-door-on-a-key
action went with the state switcher (finding 10), which is the plainer answer
to what it was for.

### 5. The doors panel is dense at 430 px — **done**

Was 14 visible buttons at the entrance; now 11.

### 6. Dead weight in the code — **done**

`hasSharedKeys` and `RoomView.readingText` removed. `gateConditionLiquid` was
wrongly listed here: nothing in `src/` calls it, but it is the seam its tests
reach the private `compile` through, so it stays with a comment saying why.
`_shown` and `_pick` stay two splits deliberately — collapsing them would emit a
two-armed split for every conditional door against a 1,000-widget ceiling.

### 7. `compile.ts` was 1,249 lines — **done**

Split into `compile.ts` (881), `compileDoor.ts` and `compileFight.ts`, verified
byte-identical output against the previous commit.

---

## Found on the re-walk

Everything above was fixed, then walked again. Two things the fixes had missed:

### 8. The door sheet said nothing about the door — **done**

Measured on the demo's forking door: **"Where it leads — Ashore · Tap to change
it, or to fork it on an item"** on a door that already forks, with the second
room (Down) never named; and **"When it is offered — Always, in some states, or
on a condition"**, which is the same sentence on every door in the app whatever
its rules. The panel row that opens the sheet knew more than the sheet did — it
draws `⑂`.

That is §0's first rule broken on the surface built to be the one place a door
is answered: every visual element encodes real data, and these two encoded a
menu.

**Fixed** in `src/features/room/doorSummary.ts`, pure and tested, so the same
sentences can go on the ledger and the build sheet later:

- `Ashore, or Down` · *Forks: Ashore when carrying a coil of rope.*
- `Only in: Has rope` · `Only when carrying a coil of rope` · both when both are
  set · `Never — hidden in every state` in the alarm colour.
- and the case the export has always warned about *after* the fact: a state rule
  on a room with no readings does nothing on the phone, so the row says
  `Always` and explains why rather than claiming a rule that Studio ignores.

### 9. The one job an item story does most could not be started from the door — **done**

A door's effects lived only in the editor's Items tab, because `EffectRows` was
a component declared inside `ItemsSection`'s body and therefore reachable from
exactly one screen. So "give this door the rope" — the commonest job in an item
story — was the one job the everything-about-one-door sheet could not begin.

**Fixed:** `EffectRows` extracted to `src/features/state/EffectRows.tsx` and
used by both, with `+ New item` beside its select. Walkthrough 8 went from 4
taps and a surface change to **3 taps without leaving the door** — and from a
blank space to a button when the story has no items yet.

The Items tab keeps the whole-room view. Two surfaces showing one control is
right where one of them is "this door" and the other is "every door here"; two
surfaces each holding *half* the controls was the thing finding 3 was about.

### 10. The state switcher was the wrong shape for what it was used for — **removed**

A plate in the room's top-left corner stood you in the room as one kind of
caller: that reading's words as the script, only the doors that reading offers,
a "not offered here" list to give the rest back, a `here` checkbox on every
door row, and a two-step action for putting a second door on one key.

Every one of those exists to answer *press 1 goes somewhere else if you have the
helmet* — which is a **fork on the door**: two ordinary rooms with a check
between them, no states involved. The switcher was the more expensive way to
say it and it broke §0's first rule doing so, because a door it had taken off
the wall was a door you had to remember existed.

**Removed**, along with `RoomView.states`, `RoomView.viewing`,
`RoomView.withheldExits` and `buildRoomView`'s state parameter. The wall is the
author's wall: every door the room has, with the conditional ones marked. Alternate
readings are unchanged — they are still written, recorded, exported and
door-ticked in the editor's Readings tab, which is where their words are.

In its place, walking through a forking door stops at `ForkGate` and asks which
of its two rooms to stand in (walkthrough 6). That is the thing the switcher
was standing in for, at 2 taps instead of a mode.

### 11. Readings were a second way to say what a fork says — **removed**

Asked directly: is "reads differently" redundant with door forking? Partly, and
the overlap was the expensive part.

- **Different words, same room** — not redundant. A fork would need a duplicate
  room, and the copies drift.
- **A reading with a destination** (`goto_node_id`) — the same outcome as a
  fork, written once on the room instead of once per door in.
- **Which doors a reading offers** (`hidden_doors`) — the states model, whose
  view had just been removed.

Measured rather than assumed: two recorded readings cost **+4 widgets**, one
forked twin room **+5**. Nearly identical, so "readings are cheaper on the
phone" was never the reason to keep them. And the live story used the whole
mechanism exactly once across 150 rooms — for the helmet door, which is the job
a fork now does better.

**Removed**: `node_variants`, `hidden_doors`, `RoomView.readings`, the reading
chain in the exporter, reading edges, the solver's `settle`/`redirects`, the
reading take kind, and the Readings tab. Migration 0020 appends every reading's
words to its room's `notes` before dropping the table — script is the one thing
that cannot be reconstructed — and says in the note when a take was orphaned.

One rule left: **a room says one thing; a door can go to two rooms.**

### 12. The first tap in every room was the same tap — **done**

"Show where doors lead" was off by default, and the measured walk of nearly
every job started by turning it on. What a door says and where it goes is the
thing you open a room to check; this is a workshop, not a reader.

**Fixed:** the panel starts open, and the toggle now *remembers being turned
off* (`lib/preference.ts`, `localStorage`, guarded — a private window can throw
on read and on write, and a switch is never worth a blank screen). So somebody
reading the story rather than building it still gets the wall and nothing else,
and gets it every time.

Walkthroughs 3, 4, 5 and 8 are each one tap shorter for it.
