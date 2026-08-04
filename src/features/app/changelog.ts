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
    version: '0.7.3',
    date: '2026-08-04',
    title: 'What the caller hears',
    changes: [
      'Dial in plays a door’s reaction. It was written into the transcript and never once played aloud — the only branch that spoke it was the branch where the caller had not moved, and walking through a door always moves you.',
      'A turn that leaves you where you were now reads the room again, the way the phone does: a wrong key, a timeout with nowhere to go, and a door that loops back into the room you are standing in were all silence before.',
      'A recorded refusal is played rather than read in the rehearsal voice.',
      'The reserved inventory key puts you back in the room afterwards, so checking your pockets no longer leaves you looking at a keypad with nothing said.',
      'Stories can be renamed, from the list. The title is on every call sheet and on the flow Studio imports, so “Untitled” used to follow an actor around.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-08-04',
    title: 'Doors open',
    changes: [
      'The doors panel starts open. It was the first tap in every room — what a door says and where it goes is the thing you came to check, and this is a workshop rather than a reader.',
      '“👁 Hide where doors lead” still puts it away, and now it stays away: the choice is remembered between visits, so somebody reading the story rather than building it gets the wall and nothing else.',
      'Every job that starts at a door is one tap shorter for it — forking, giving an item, sending a door back to a room that exists.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-08-04',
    title: 'Out of the doorway',
    changes: [
      'Figures stand in the wings either side of the archways instead of across the middle of the floor. One figure used to be centred on the middle door, with its name plate over the opening and its body across the destination — the two things on the wall that have to stay readable.',
      'The name goes at the figure’s feet now, under everything the wall hangs, so a long name has room to be a long name.',
      'A silhouette that is longer one way than the other turns to face into the room, so what the edge of the picture crops is its tail rather than its head.',
      'Two are drawn — one per wing — and anybody else is named along the front. A third would have to stand in a doorway.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-08-04',
    title: 'Finding things',
    changes: [
      'A Help button in the top menu: every feature, what it does, and the taps that get you there — searchable, because the question is nearly always “where is the thing that does X”. Each entry also says what has to be true FIRST, since most of what looks broken is a prerequisite nobody mentioned.',
      'Two cast entries that are one person can be merged. The import spells a name however the script did, so Froggem and Froggum come back as two characters with a line each; near-misses are now offered on the Cast page. Merging moves the lines, rewrites the script to match, and keeps every take — and Undo puts it back.',
      'The call sheet is findable. It was an underlined half-sentence three sections down the Cast page; it is now a button under its own heading, and copy and download stay available after everything is recorded.',
      'The control that stands a figure in a room is labelled “Draw them in the room” instead of being an unlabelled dropdown, and says so when a character has a figure but no lines to be drawn beside.',
      'The top menu is buttons rather than underlined words, and the version number is one of them.',
    ],
  },
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
