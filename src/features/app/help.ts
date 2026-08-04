/**
 * Every feature, what it does, and where it is.
 *
 * Written because three of them could not be found by the person who asked for
 * them: the call sheet was an underlined half-sentence three sections down the
 * Cast page, the figure control was an unlabelled select whose only explanation
 * was a tooltip, and "reads differently" and forking looked like the same
 * feature until somebody asked.
 *
 * The `where` line is the point. A description with no path is a feature that
 * still cannot be found, so every entry names the taps — and `needs` says the
 * thing that has to be true first, because most of what looks broken here is a
 * prerequisite nobody mentioned.
 */
export interface HelpTopic {
  title: string
  /** Tap by tap, from the room you stand in when the story opens. */
  where: string
  what: string
  /** What has to be true before it does anything. */
  needs?: string
}

export interface HelpSection {
  heading: string
  blurb: string
  topics: HelpTopic[]
}

export const HELP: HelpSection[] = [
  {
    heading: 'Walking and building',
    blurb: 'You stand in a room. The archways are the keys the caller presses.',
    topics: [
      {
        title: 'What every door says and where it goes',
        where: 'Already open, under the room. “👁 Hide where doors lead” puts it away.',
        what: 'The label, the room behind, and one ⋯ per door. It starts open because this is a workshop — and it remembers being closed, for when you want the wall and nothing else.',
      },
      {
        title: 'Walk through a door',
        where: 'Tap an archway.',
        what: 'Takes you into the room behind it, the way a caller goes. ◄ BACK walks you out again, and swiping right does the same.',
      },
      {
        title: 'Cut a new room',
        where: 'Tap a bricked archway — the one with no door in it.',
        what: 'Makes the room and stands you in it, ready to name. This is the main way a story gets built.',
      },
      {
        title: 'Point a door at a room that already exists',
        where: 'The doors panel, under the room → “↺ send it back to a room that exists”.',
        what: 'Offers the way you came first, then everywhere you have been, then a search. Pointing a door backwards is how a loop or a hub gets made.',
      },
      {
        title: 'Everything about one door',
        where: 'The doors panel, under the room → ⋯ beside the door.',
        what: 'The key, what the caller hears, where it leads, what it gives or takes, when it is offered, what is heard on the way through, insert a room, remove it.',
      },
      {
        title: 'Put a room between two that are joined',
        where: 'The doors panel, under the room → ⋯ → ⤵ Insert a room.',
        what: 'A → B becomes A → new → B, and walks you into the new one. The reverse is Collapse, in the editor’s Room tab.',
      },
      {
        title: 'Rename a room',
        where: 'Tap its name in the header. Or name the room BEHIND a door from the doors panel.',
        what: 'The name is what door plates show. A room’s slug follows its title once — on the unnamed→named step — and never again, because by then an actor has a manifest.',
      },
    ],
  },
  {
    heading: 'Writing and voices',
    blurb: 'A room is one block of narration until you split it by who says what.',
    topics: [
      {
        title: 'Write a room’s script',
        where: '✎ EDIT → Write.',
        what: 'One block of text. A live estimate warns past 15 seconds, because that is a long time to hold a phone.',
      },
      {
        title: 'Split a room between speakers',
        where: '✎ EDIT → tick “🗣 Someone speaks” → Voices.',
        what: 'Turns the narration into attributed lines. The text and the lines are one thing seen twice — editing either rewrites the other, so they cannot drift.',
        needs: 'Nothing. But once a line has a take, the lines are what plays, not the block.',
      },
      {
        title: 'Cast a character',
        where: 'Cast in the top menu → type a name → Add.',
        what: 'Names the script already uses appear under “Speaking, but not cast” with a Cast button — found by reading every room for a name followed by a colon.',
      },
      {
        title: 'Two spellings of one character',
        where: 'Cast → “Might be the same person”.',
        what: 'Names close enough to be a typo, offered as merges. Merging moves every line to the one you keep and rewrites the script to match; takes survive and Undo puts it back.',
        needs: 'Only appears when there is a pair close enough to ask about. Shark and Shark King are deliberately left alone.',
      },
      {
        title: 'Draw somebody standing in the room',
        where: 'Cast → the character → “Draw them in the room” → pick a silhouette.',
        what: 'Stands that figure in every room the character SPEAKS in — in the wings either side of the archways, with their name at their feet. Two are drawn, one per side; anybody else is named along the front of the room.',
        needs: 'The room’s script must be split by speaker and a line attributed to them. A figure on a character with no attributed lines draws nothing — the Cast page says so where it happens.',
      },
      {
        title: 'What is heard between two rooms',
        where: 'The doors panel, under the room → ⋯ → Heard on the way through.',
        what: 'A door’s own script and take, played after the keypress and before the next room. Walking through a door that has one stops to play it.',
      },
    ],
  },
  {
    heading: 'Items and forks',
    blurb: 'One mechanism for a conditional destination, one for a conditional door.',
    topics: [
      {
        title: 'Give or take an item at a door',
        where: 'The doors panel, under the room → ⋯ → “What it gives or takes” → pick the item.',
        what: '“+ New item” is beside the same control, so you never have to go and make one first. Choose “take away” to remove something from the caller’s satchel.',
      },
      {
        title: 'One key, two rooms',
        where: 'The doors panel, under the room → ⋯ → Where it leads → “⑂ Make this door fork on an item”.',
        what: 'Press 1 goes one place carrying the helmet and another without it. Two ordinary rooms, each with its own name, script, cast and exits.',
        needs: 'The door must already lead somewhere. The sheet offers to point it if not.',
      },
      {
        title: 'Visit both halves of a fork',
        where: 'Tap the forking door’s archway.',
        what: 'Asks which of its two rooms to stand in, each under the condition it belongs to, and wires a route that leads nowhere yet.',
      },
      {
        title: 'Only offer a door to some callers',
        where: 'The doors panel, under the room → ⋯ → “When it is offered”.',
        what: 'Always, or only when they are carrying something. The key is still accepted — a keypad takes what it takes — but it goes back to the choices.',
        needs: 'Nothing announces a door hidden this way. If the caller needs telling it is there, fork the door INTO the room instead and let that room’s script say so.',
      },
      {
        title: 'Refuse a door out loud',
        where: '✎ EDIT → Items → the door → “+ Require something”.',
        what: 'Says why they cannot go, then returns them to the choices. The refusal is a line like any other and needs its own take, or the caller is bounced with no explanation.',
      },
      {
        title: 'What the caller could be carrying here',
        where: '🎒 Satchel in the top menu.',
        what: 'Every combination of items a caller can reach this room holding, worked out by walking the whole story. It is also what reports an item nothing ever grants.',
      },
    ],
  },
  {
    heading: 'Recording',
    blurb: 'Three ways in, all doing the same four steps to the same files.',
    topics: [
      {
        title: 'Record where you are standing',
        where: '✎ EDIT → Sound → hold the button.',
        what: 'The torch in the room lights when everything the room plays has a take — every line, not just the first.',
      },
      {
        title: 'Record the whole story',
        where: 'Record in the top menu.',
        what: 'Every take in the story, in story order rather than alphabetically, so an actor reads front to back.',
      },
      {
        title: 'The page you hand a voice actor',
        where: 'Cast → “Call sheets & recording queue” → ▸ Call sheet → copy or download.',
        what: 'Their lines only, in story order, with the exact filename each take must come back as — the same string the bulk importer matches on, so a folder named from the sheet lands without renaming anything.',
      },
      {
        title: 'Bring in finished takes',
        where: 'Export → the audio link, or /audio on the story.',
        what: 'Drop a folder in and it matches files to slots by name. Every take is converted to 8 kHz mono WAV in the browser first — the phone cannot play what a browser records.',
      },
    ],
  },
  {
    heading: 'Checking and shipping',
    blurb: 'Everything that answers “is it finished, and will it work”.',
    topics: [
      {
        title: 'See the whole story',
        where: 'Map in the top menu.',
        what: 'Auto-laid-out, filled by how far along each room is: inked = recorded, pale = written, dotted = empty, red = sealed. Every tally is tappable and lights the rooms behind it.',
      },
      {
        title: 'Everything unfinished',
        where: 'Ledger in the top menu.',
        what: 'Rooms nothing leads to, rooms nothing reaches, endings with exits, items nothing grants, doors with no words.',
      },
      {
        title: 'Rename a story',
        where: 'Stories → ✎ Rename beside it.',
        what: 'The story’s title, which is the name on every call sheet and on the flow Studio imports — not a room’s name, which is the one in the header while you are inside.',
      },
      {
        title: 'Walk it as a caller',
        where: 'Dial in.',
        what: 'Press digits and see where you land, carrying what you would really be carrying. Unrecorded lines are spoken aloud as a rehearsal aid — the exported flow never speaks anything.',
      },
      {
        title: 'Clean up after an import',
        where: 'Tidy.',
        what: 'Short names for rooms whose title is a whole sentence, and rooms that were really actions. Both suggestions; nothing is applied on its own.',
      },
      {
        title: 'Get it into Twilio',
        where: 'Export → read the warnings → copy the flow JSON → paste into Studio.',
        what: 'A build sheet and a flow definition. Nothing is ever written to your Twilio account. The warnings are the list of what will be silent on the phone.',
      },
      {
        title: 'Undo',
        where: 'Undo in the top menu.',
        what: 'Replays the inverse against the database rather than restoring a snapshot, so it survives a reload and cannot be undone by the next read.',
      },
      {
        title: 'Which build am I looking at',
        where: 'The version button, top right.',
        what: 'The version, the commit, when it was built, and what changed in each release.',
      },
    ],
  },
]
