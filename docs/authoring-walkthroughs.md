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

### Now

| # | Tap | Surface |
|---|---|---|
| 1 | Show where doors lead | room |
| 2 | ⋯ on the door → Where it leads | room / door sheet |
| 3 | ⑂ Make this door fork *(or "+ Create the first item", right there, if none exists)* | fork sheet |
| 4 | the other route → **⛏ Cut a new room called "…"** | picker |

**3 taps with an item in the story, ~4 without. One dead end removed, and the
second room no longer has to exist first.**

---

## 5. Hide a door from callers without an item

There are **two ways to do this**, they produce the same visible result, and
they are stored differently.

### Before — two paths, 4 taps and 8, different storage

**A, through the state plate** (needs the room to have a reading): plate → the
state → Show where doors lead → untick **here**. Four taps.

**B, through a `hide` gate** (works anywhere): EDIT → tick "an item changes
hands" → Items → find the door → + Require something → choose the item →
change "say why" to "don't offer the choice at all" → Done. Eight taps.

Same visible result. Nothing said which was which, or warned when both were set
on one door.

### Now — one question

| # | Tap | Surface |
|---|---|---|
| 1 | Show where doors lead | room |
| 2 | ⋯ on the door → **When it is offered** | room / door sheet |
| 3 | Always · Only in some states · Only when carrying something | offered sheet |

**3 taps.** The mechanism follows from the answer instead of from which screen
you found first. Both are shown when both are set, and it says so.

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

### 1. Item logic is behind a checkbox, and the checkbox is on another tab — **done**

The Items tab does not exist until "🎒 An item changes hands" is ticked in
Write. Every item flow therefore starts with two taps that do nothing except
reveal the place you were already trying to reach — and the fork sheet, which
knows perfectly well that no items exist, dead-ends into it.

**Costs:** 2 taps on every item flow, and one dead end (walkthrough 4, step 3).

**Fix:** show the Items tab whenever the *story* has any state vars, not when
the room does. Add "+ Create an item" directly to the fork sheet and the gate
builder, so neither ever dead-ends.

### 2. Two mechanisms for "this door isn't offered" — **done**

`hide` gates and `hidden_doors` (walkthrough 5) look identical to an author and
are stored differently. One is 4 taps and one is 8. The 4-tap one silently
requires the room to have a reading. Nothing warns when both are set on one
door.

**Fix:** one control on the door — *Offered: always / only in these states /
only when ⟨condition⟩* — writing whichever mechanism fits the answer.

### 3. Neither door surface is complete — **done**

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

**Fixed** by going further than that: one `⋯` per door opens a sheet holding
the digit, the label, where it leads, when it is offered, what is heard on the
way through, insert and remove. The row keeps only what is worth scanning. The
editor's Doors tab stays as the all-doors-at-once view.

### 4. Order-of-operations traps — **done**

Three jobs only work if you do them in an undocumented order:

- a fork needs the door pointed somewhere *before* it can fork (the sheet says
  so, but only after you open it);
- a second door on a key needs the first one hidden in that state *first*;
- a visibility rule needs the room to have a reading *first*.

**Fixed**, each as an action rather than an explanation:

- the fork sheet offers "Point this door at a room →" when the door leads
  nowhere, and the picker behind it can cut the room;
- the door sheet, standing in a state, offers "Make ⟨n⟩ a different door here",
  which hides this one in that state and puts a new one on the key — in the
  order that leaves nothing broken half way;
- the offered sheet offers "+ Give this room a second reading" when there are no
  states to choose between, rather than leaving it to an export warning.

### 5. The doors panel is dense at 430 px — **done**

Was 14 visible buttons with the panel open at the entrance; now **11**. ⑂ and 🔊
collapsed into one `⋯` per door, which carries the whole door sheet — and
"always offered" no longer takes a slot, because §0's rule is that every visual
element encodes real data and *always* is the absence of it. A door that is
conditional still says `sometimes`; one that is never offered still says so.

### 6. Dead weight in the code — **done**

- `hasSharedKeys` — written, never called. **Removed.**
- `RoomView.readingText` — computed for every room, consumed by nothing since
  the reading's words moved into `lines`. **Removed**, and its test rewritten to
  assert on `lines`, which is where the behaviour actually is.
- `gateConditionLiquid` — **this finding was wrong.** Nothing in `src/` calls
  it, but it is the seam its tests reach the private `compile` through, and
  those tests pin the substring trap, the negation pushdown and the empty
  and/or identities. Kept, with a comment saying so.
- `_shown` and `_pick` in the exporter are two splits on the same variable.
  **Left alone deliberately.** `_pick` subsumes `_shown` in principle, but only
  a door that shares its key needs `_pick`, and collapsing them would emit a
  two-armed split for every conditional door in the story — more widgets against
  a 1,000 ceiling, to save one branch in a file that is now 881 lines. The
  comment in `compileDoor.ts` says which is which.

### 7. `compile.ts` is 1,249 lines

The per-choice loop is ~250 of them and shares little with room emission.
Splitting them would make the next export change safer — and there has been an
export change in nearly every round of work.
