# The story pack and the call snapshot are read with kotlinx.serialization.
# Keep the model whole rather than trusting reflection-free paths on every R8.
-keep class com.jackie.dungeon.engine.** { *; }
-keep class com.jackie.dungeon.call.** { *; }
