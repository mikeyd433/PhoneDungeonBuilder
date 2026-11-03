package com.jackie.dungeon.sync

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant

/**
 * Who else has a story open, and which scene (`0024_presence.sql`). Each phone
 * says where it is every few seconds; anyone not heard from for [STALE_S]
 * seconds has gone.
 */
object Presence {
    const val STALE_S = 25L

    data class Person(val userId: String, val email: String, val sceneId: String?) {
        /** What to call them: the part of the email before the @. */
        val name get() = email.substringBefore('@').ifBlank { "Someone" }.replaceFirstChar { it.uppercase() }
        val initial get() = name.first().uppercaseChar().toString()
    }

    /** Say this phone is in [storyId], with [sceneId]'s sheet open (or none). */
    fun here(db: Supabase, storyId: String, sceneId: String?) {
        db.rpc("set_presence", mapOf("p_story" to storyId, "p_scene" to sceneId))
    }

    /** Everyone else in [storyId] heard from recently. */
    fun others(db: Supabase, storyId: String, me: String, now: Instant = Instant.now()): List<Person> =
        db.select("story_presence", "story_id=eq.$storyId&select=user_id,email,scene_id,seen_at").mapNotNull { e ->
            val o = e.jsonObject
            val who = o.s("user_id") ?: return@mapNotNull null
            if (who == me) return@mapNotNull null
            val seen = o.s("seen_at")?.let { runCatching { Instant.parse(Sync.normal(it)) }.getOrNull() } ?: return@mapNotNull null
            if (seen.isBefore(now.minusSeconds(STALE_S))) return@mapNotNull null
            Person(who, o.s("email").orEmpty(), o.s("scene_id"))
        }

    private fun JsonObject.s(k: String): String? = this[k]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.takeIf { it != "null" }
}
