# Jackie Dungeon — phone and car app

The phone app is becoming the main way to build a story, not just play one.
On the **phone**: a list of stories kept on the phone, a **flowchart editor**
(scenes, choices, keys, scripts with speakers, replies, items given and required,
refusals and forks, undo), and a **PLAY** tab with a readable transcript and a
keypad. On the **car screen, while parked**: the same story as a green-phosphor
terminal, with the phone as the keypad. Built the Brenda way — an Android Auto
*parked app*, not Car App Library templates.

Planned next, in order: recording takes on the phone (converted to the 8 kHz WAV
Twilio plays), exporting for Twilio (a Studio flow JSON plus the WAVs, to import and
upload by hand — the app never logs in to Twilio), then sync with Supabase — after which the web
app can retire.

```
engine/   pure Kotlin, no Android, all tested on the JVM:
            engine/  the story engine (port of PlaytestEngine)
            call/    one phone call: typing, hold, resume, saves
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

- Recording on the phone (next), and exporting for Twilio (a Studio flow JSON plus WAVs).
- Sync with Supabase; until then the phone's stories and the web app's drift apart.
- Nudging boxes on the flowchart, and chapters (the field exists; no UI yet).

- Not yet run on a real phone, the DHU or a car — everything here was built and
  unit-tested on a machine with no device. The car screen was previewed by running
  its exact shaders in WebGL2.
- Fetching a story by link (rather than opening a file) and listing several
  stories.
- Settings for frame rate (fixed at 30) and internal resolution (fixed at 360p).
- Renderer screenshot tests on headless Mesa, as Brenda Arcade has.
