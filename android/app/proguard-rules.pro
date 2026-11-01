# The story pack and the call snapshot are read with kotlinx.serialization.
# Keep the model whole rather than trusting reflection-free paths on every R8.
-keep class com.jackie.dungeon.engine.** { *; }
-keep class com.jackie.dungeon.call.** { *; }
# QuickJS (runs the Twilio exporter) reaches its Kotlin side from native code by name.
-keep class com.dokar.quickjs.** { *; }
# Story rows (saved, backed up, synced) and the sync's own records, likewise.
-keep class com.jackie.dungeon.story.** { *; }
-keep class com.jackie.dungeon.sync.** { *; }
