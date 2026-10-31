# Jackie Dungeon — phone and car app

A story you built in the web app, played as a phone call: the story types out on a
green-phosphor terminal on the **car screen while parked**, and the **phone is the
keypad**. Built the Brenda way — an Android Auto *parked app*, not Car App Library
templates.

```
engine/   pure Kotlin, no Android: the story engine and the call session
app/      the Android app: phone keypad, car screen (OpenGL ES 3), audio
```

## How a story gets here

1. In the web app: **Export → Story pack (Android)** downloads `<title>.jackie.json`.
2. On the phone: **OPEN STORY…** and pick that file.

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

- **Without a car:** open the app → **PREVIEW ON PHONE**. The terminal sits in
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

- Not yet run on a real phone, the DHU or a car — everything here was built and
  unit-tested on a machine with no device. The car screen was previewed by running
  its exact shaders in WebGL2.
- Fetching a story by link (rather than opening a file) and listing several
  stories.
- Settings for frame rate (fixed at 30) and internal resolution (fixed at 360p).
- Renderer screenshot tests on headless Mesa, as Brenda Arcade has.
