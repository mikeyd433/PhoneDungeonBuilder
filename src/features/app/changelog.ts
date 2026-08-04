/**
 * What changed, in the words of somebody who uses the app.
 *
 * ONE copy, here. A `CHANGELOG.md` beside it would be the same drift the
 * narration and the lines are carefully kept out of: two hand-maintained lists
 * of the same facts, and the one nobody reads is the one that goes stale.
 *
 * Entries are what an AUTHOR would notice, not what the diff did — "walking
 * through a forking door asks which room" rather than "added ForkGate.tsx".
 * A version with nothing an author would notice does not get an entry.
 *
 * Newest first. `version` matches `package.json` for the top one; the ones
 * below it are the milestones this work actually landed in, dated from the
 * commits rather than from a release that never happened.
 */
export interface Release {
  version: string
  /** ISO date of the last commit in it. */
  date: string
  /** Four words at most — what the release was about. */
  title: string
  changes: string[]
}

export const RELEASES: Release[] = [
  {
    version: '0.6.0',
    date: '2026-08-04',
    title: 'One key, two rooms',
    changes: [
      'Walking through a forking door now stops and asks which of its two rooms to stand in, each under the condition it belongs to. Before this the far side of a fork could only be reached from the map.',
      'A door’s sheet says what the door already IS — both rooms of a fork and which condition picks them, and whether it is offered always or on a condition. It used to show the same words on every door in the story.',
      'Give or take an item without leaving the door. It was only ever editable in the editor’s Items tab.',
      'Alternate readings are gone. A room says one thing; a door can go to two rooms depending on a check. Any reading’s words were kept, appended to its room’s notes.',
      'The state switcher in the room’s corner is gone with them. Every door the room has is on one wall, with the conditional ones marked rather than hidden.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-03',
    title: 'No dead ends',
    changes: [
      'One ⋯ per door opens everything about it — the key, the label, where it leads, when it is offered, what is heard on the way through, insert and remove.',
      'One question for when a door is offered, instead of two mechanisms in two places that did the same thing.',
      'Make an item where you are asked for one, and cut the room a fork needs from the picker. Neither control dead-ends into another tab any more.',
      'A fork can ask about several items — “any one of these” opens the door with the crowbar or the key, and spends only the one that worked.',
      '“Use up what opened this” now reaches the exported flow. It was honoured in rehearsal and by nothing on the phone.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-03',
    title: 'Forks and dressing',
    changes: [
      'Fork a door on an item: one key, two rooms, each with its own name, script, cast and exits.',
      'Send a door back to a room that already exists — offered as the way you came, then where you have been, then a search.',
      'Rooms are dressed by kind, with figures standing in the ones somebody is in.',
      'Headings are carved in an uncial hand, which survives being uppercased and letterspaced down to the 9px plates.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-08-03',
    title: 'Recording at scale',
    changes: [
      'Record the whole story from one screen, in story order, without walking to each room.',
      'Per-actor call sheets, naming every file the way the importer expects it.',
      'Drop a folder of finished takes in; clear a bad one. An accidental one-second take reads as a recorded room and plays as silence.',
      'Every take is converted to 8 kHz mono WAV in the browser. The phone cannot play what the recorder makes.',
      'Tidy up after the import — short names for sentence-titles, and rooms that were really actions.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-02',
    title: 'Cast, dialogue, fights',
    changes: [
      'A cast list with voice actors, and narration split by who says it — so two separately-booked actors can share a scene.',
      'Fights: each round names where every key goes, and silence repeats the round before it is called.',
      'Door reactions — what is heard between the keypress and the next room, with its own script and take.',
      'The caller can press one key in any room to hear what they are carrying.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-02',
    title: 'The walker',
    changes: [
      'Stand in a room; the exits are the choices; a graph-paper automap shows the structure.',
      'Import a Brainstorm graph or a CSV, with the columns matched to what the tracker actually has.',
      'Export a Twilio Studio flow definition Studio will accept, plus a build sheet.',
      'Playtest by dialling in, a ledger of everything unfinished, comments and soft locks, and an offline write queue.',
    ],
  },
]

/** The version this build calls itself. Top of the list, by construction. */
export const CURRENT = RELEASES[0].version
