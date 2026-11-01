# Jackie Dungeon — phone and car app

The phone app is becoming the main way to build a story, not just play one.
On the **phone**: a list of stories kept on the phone, a **flowchart editor**
(scenes, choices, keys, scripts with speakers, replies, items given and required,
refusals and forks, undo), and a **PLAY** tab with a readable transcript and a
keypad. On the **car screen, while parked**: the same story as a green-phosphor
terminal, with the phone as the keypad. Built the Brenda way — an Android Auto
*parked app*, not Car App Library templates.

**Editing on the car screen**, while parked: the car has two modes, **PLAY** (the
terminal) and **EDIT**, switched from a corner tab on the terminal, PLAY MODE on the
editor's toolbar, or CAR SCREEN PLAY | EDIT on the phone. EDIT is a map of the whole
story (drag, pinch, or VIEW ▾ to fit, zoom, jump to the start or a chapter) and a
full-screen page per scene: the script with a ▶ on every recorded part, what the scene
gives and what is still silent, and the choices as tiles along the bottom (tap the key
to pick the choice, the destination to walk there, the ◆ line for its items). The
toolbar's menus edit: SCENE ▾ (rename, script, ending, play its take, play from here,
make start, delete), CHOICE ▾ (words, reply, key, where it leads, delete), ITEMS ▾
(gives, needs, refuse or fork), plus + CHOICE, ▶ PLAY HERE (pick what to carry, on the
car or the phone) and UNDO. **Typing happens on the phone**, which opens whatever the car
opens — and the car opens whatever the phone opens; text shows on the car as it is typed.
The map can outline empty scenes, dead ends and unrecorded scenes, switched on from the
phone (LIGHT UP). All of it is `engine/.../car/` — pure, and tested in `CarEditorTest`;
the call holds while the car is editing. The editor's text goes up to L; at XL only the
terminal grows.

**Moving things on the flowchart:** hold a scene, then drag it; hold empty space inside a
chapter's frame (or its name) to drag the whole lane. The layout still decides where
everything goes — a move is an offset on top of it (`nudge_x`/`nudge_y` on the scene,
`lane_nudges` on the story, phone-only fields), so it undoes like any edit and
SAVE AS DEFAULT makes the arrangement on screen the one BACK TO DEFAULT returns to
(`stories.layout_home`); AUTO LAYOUT drops every move and the default. The chapter
buttons frame their lane; ALL fits the story.

**Deleting a scene joins up its neighbours:** the choices that led into it lead on to
where it went (`StoryEditor.deleteScene`). One way on joins by itself; with several,
DELETE asks which, or leaves them leading nowhere yet. Undo brings it all back.

**Choices that need items:** NEEDS takes one item or several, and with several,
"any one of these" or "all of these" (an `or` / `and` of `has` — the same gate the web
app writes). If the caller doesn't have it: refuse and stay, or go to another scene —
a fork, where each scene has its own script, takes and choices.

Recording: tap ● REC on a scene, a speaker line, a reply or a refusal (or FILE… to
bring one in). Every take is stored as 8 kHz mono WAV (`engine/.../audio/IvrWav.kt`),
the shape Twilio's Play needs.

Exporting: **EXPORT** on a story makes one zip — `flow.json` (Studio → Import from
JSON), `audio/` (upload to the address you set, e.g. a Twilio Assets service), a README
with the steps and everything that will be silent, the build sheet, the audio manifest
and the script. The app never logs in to Twilio. The flow comes from the **web app's
own exporter**, bundled (`pnpm build:phone-export` → `app/src/main/assets/js/exporter.js`)
and run in QuickJS; `TwilioExportTest` runs that bundle in QuickJS on the phone's own
copy of each fixture story and requires the web app's output. Rebuild the bundle after
changing anything under `src/features/export/` — a vitest check fails until you do.

Next: sync with Supabase, after which the web app can retire.

```
engine/   pure Kotlin, no Android, all tested on the JVM:
            engine/  the story engine (port of PlaytestEngine)
            call/    one phone call: typing, hold, resume, saves
            car/     the car screen's editor: state, every tap, and what each frame draws
            story/   the rows the phone edits, StoryEditor (every edit), PackBuilder,
                     Dialogue (speaker split), FlowLayout (where the flowchart puts things)
app/      the Android app: Studio (stories on the phone, undo), the Compose editor
          and play screens, the car screen (OpenGL ES 3), audio
```

## Stories on the phone

Each story is saved as table rows in `files/stories/<id>.rows.json` — the
Supabase table shapes, so sync can be added without a second model. Every edit
is a pure function in `StoryEditor`, applied by `Studio.edit`, which keeps the
undo stack, saves, and hands the player a fresh pack built by `PackBuilder`.

`PackBuilderTest` holds the phone to the web app: from each fixture's rows it must
build exactly the pack `buildStoryPack` built, and split every script exactly as
`splitNarration` did.

## Syncing with Supabase

Signed in (stories list → ☁ CLOUD → SIGN IN, with the web app's email and a code sent
by email), the phone keeps its stories in step with the cloud: a few seconds after each
edit, when the app opens and when the connection returns. Whole stories at a time:
changed on one side, it moves to the other; changed on both, the newer edit wins; a
story deleted on the phone is deleted in the cloud. Takes recorded on the phone are
uploaded to `story-audio/<story id>/phone/` and the cloud points there, while the phone
keeps playing its own files. The first sync of a story that came from the cloud with
short ids (William, JCFC) finds the cloud copy by title, takes its ids and replaces it.

The rules are `engine/.../sync/Sync.kt`, held by `SyncTest` against `FakeSupabase` (the
same PostgREST calls, unique slugs, foreign keys and `edited_at` bump as the real one).
The cloud side is migration `0022_phone_sync.sql`: the phone-only columns, and
`stories.edited_at`, bumped by triggers on every story table so deletes count too.

**One-time setup in the Supabase dashboard:** Authentication → Emails → Templates →
Magic Link: add `Your code: {{ .Token }}` to the body. Without it the email only has a
link, and the phone needs the code.

## Backing up

Stories live on the phone, so the stories list backs them up: **back up** on a story
(or **BACK UP ALL**) makes one `.jdbackup.zip` per story — `backup.json`, `rows.json`
and every take recorded on the phone under `takes/` — and hands it to the share sheet
(Drive, email, Files). **RESTORE…** picks one back up on any phone; if that phone
already has the story, replace it or keep both. Takes from the Supabase bucket stay as
links. Each story says when it was last backed up, in amber after a week. The format
is `engine/.../story/Backup.kt` (`BackupTest`), the zipping `app/.../Backups.kt`
(`BackupsTest`, Robolectric). This is a stopgap until Supabase sync.

## How a story gets here

The app ships with **William Son of Joel** (what it opens with), the **JCFC Hotline**
phone tree and the walkthrough, copied into the phone's story list on first launch
and editable from then on.
Those two real stories were copied from Supabase on 2026-10-31, read only, and every
table was checked against the database by checksum. Their rows live in
`src/features/pack/fixtures/`, which also makes them golden fixtures: both engines
are tested on them every run. They are a snapshot — edits made since don't appear
until they are copied again.

The web app's **Export → Story pack (Android)** still exists, but a pack is for
playing, not editing, so the phone no longer opens one; stories are made and edited
on the phone.

The pack carries what is *heard* (lines, speakers, audio links) already worked out
by the web app, and the *rules* (gates, items, fights, timeouts) for the Kotlin
engine to apply. See `src/features/pack/storyPack.ts`.

Audio streams from the same public Supabase links the Twilio flow plays. A part
with no recording is shown dimmer on the car screen and is silent, as on the phone.

## The engine agrees with the web app — and is tested for it

`engine/` is a line-by-line port of `src/features/playtest/engine.ts`. It is not
trusted on its own: `src/features/pack/golden.test.ts` packs two stories (the
walkthrough and a "kitchen sink" that uses every rule) and records sessions of
random and scripted key presses through the **TypeScript** engine.
`GoldenSessionsTest.kt` replays them through the **Kotlin** engine and requires
the same thing heard, word for word, and the same state, every turn.

- Change the TypeScript engine → `pnpm test` fails until you regenerate:
  `JD_UPDATE_GOLDEN=1 pnpm test golden`
- Then `./gradlew :engine:test` fails until the Kotlin port matches. Port the
  change; don't regenerate around it.

## Parked-only lifecycle

`AppGraph` holds one `CallSession`. When the car screen goes away (the car moves,
Android Auto disconnects, the app is backgrounded) the call goes **ON HOLD**: the
audio stops, the clock stops, keys do nothing, and a suspend save is written to
`files/call.json`. When a screen comes back it shows **RECONNECTING 3 2 1** and
picks up the same line. It also autosaves every 5 seconds and after every key, so
a killed process loses nothing. All of this is tested on the JVM in
`CallSessionTest`.

## Build and test

Needs JDK 17+ and the Android SDK (`local.properties` → `sdk.dir=…`, git-ignored).

```
./gradlew :engine:test          # engine + golden sessions + call lifecycle (JVM, no device)
./gradlew :app:assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:bundleRelease    # signed AAB for Play, if keystore.properties exists
```

## Try it

- **Without a car:** open a story → **PLAY**, or **CAR PREVIEW** from there. The terminal sits in
  the middle at a head unit's shape with the keypad beside it.
- **Text size on the car screen:** **CAR TEXT  S M L XL**, under the keypad on PLAY and
  beside it in CAR PREVIEW. It takes effect at once and is remembered (22, 17, 13 or 10 rows).
- **Desktop Head Unit:** Android Auto developer settings → start head unit server,
  then run the DHU. Test 800×480 and 1920×720 at least.
- **In a car:** the phone needs **Android 15+**. For sideloaded or internal-testing
  builds, turn on Android Auto's developer settings and enable **Unknown sources**,
  or the app won't appear on the car screen.

## Release

Same routine as the Brenda apps:

- Its own Play listing, app id `com.jackie.dungeon`, `appCategory="game"`, no
  `distractionOptimized` metadata.
- Signed with an upload key that is **never committed**. `keystore.properties`
  (git-ignored) at `android/`:
  ```
  storeFile=../jackie-upload.jks
  storePassword=…
  keyAlias=…
  keyPassword=…
  ```
  or the `JD_STORE_FILE` / `JD_STORE_PASSWORD` / `JD_KEY_ALIAS` / `JD_KEY_PASSWORD`
  environment variables. Never generate a replacement key.
- Each release: bump `versionCode` (and `versionName` if anyone would notice),
  run the tests, `./gradlew :app:bundleRelease`, check the signature with
  `keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab`,
  then upload to the **internal testing** track.

## Not done yet

- Takes for items (picked up / used up / readback) and the inventory key: not in the phone's editor yet.
- Sync with Supabase; until then the phone's stories and the web app's drift apart.

- Not yet run on a real phone, the DHU or a car — everything here was built and
  unit-tested on a machine with no device. The car screen was previewed by running
  its exact shaders in WebGL2.
- Fetching a story by link (rather than opening a file) and listing several
  stories.
- Settings for frame rate (fixed at 30) and internal resolution (fixed at 360p). Text size is set (CAR TEXT).
- Renderer screenshot tests on headless Mesa, as Brenda Arcade has.
