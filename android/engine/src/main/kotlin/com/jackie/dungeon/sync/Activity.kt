package com.jackie.dungeon.sync

import com.jackie.dungeon.story.StoryRows
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant

/**
 * The activity log (`0025_activity.sql`): who changed what, and where. Each edit
 * is written as what Undo calls it ("Edit script") and the scene it touched, so
 * the log can say "Carter · Edit script · Player Select" and a tap can go there.
 */
object Activity {
    data class Entry(val userId: String?, val email: String, val label: String, val sceneId: String?, val at: Instant) {
        val name get() = email.substringBefore('@').ifBlank { "You" }.replaceFirstChar { it.uppercase() }
    }

    fun log(db: Supabase, storyId: String, label: String, sceneId: String?) {
        db.rpc("log_activity", mapOf("p_story" to storyId, "p_label" to label, "p_scene" to sceneId))
    }

    /** The newest [limit] entries for [storyId], newest first. */
    fun recent(db: Supabase, storyId: String, limit: Int = 60): List<Entry> =
        db.select("story_activity", "story_id=eq.$storyId&select=user_id,email,label,scene_id,created_at&order=created_at.desc&limit=$limit").mapNotNull { e ->
            val o = e.jsonObject
            val at = o.s("created_at")?.let { runCatching { Instant.parse(Sync.normal(it)) }.getOrNull() } ?: return@mapNotNull null
            Entry(o.s("user_id"), o.s("email").orEmpty(), o.s("label") ?: return@mapNotNull null, o.s("scene_id"), at)
        }.sortedByDescending { it.at }.take(limit)

    /**
     * The scene an edit touched: the first scene whose row changed, or the scene a
     * changed (or new, or removed) choice leaves from. Null for edits that touch
     * no scene (a rename of the story, a layout reset).
     */
    fun sceneOf(before: StoryRows, after: StoryRows): String? {
        val was = before.nodes.associateBy { it.id }
        after.nodes.firstOrNull { n -> was[n.id].let { it == null || it.copy(nudgeX = n.nudgeX, nudgeY = n.nudgeY) != n } }?.let { return it.id }
        val wasC = before.choices.associateBy { it.id }
        after.choices.firstOrNull { wasC[it.id] != it }?.let { return it.fromNodeId }
        val now = after.choices.mapTo(HashSet()) { it.id }
        before.choices.firstOrNull { it.id !in now }?.let { c -> return c.fromNodeId.takeIf { id -> after.nodes.any { it.id == id } } }
        after.nodes.firstOrNull { n -> was[n.id] != n }?.let { return it.id } // only moved
        val g0 = before.gates.associateBy { it.choiceId }
        (after.gates.firstOrNull { g0[it.choiceId] != it }?.choiceId ?: before.gates.firstOrNull { g -> after.gates.none { it.choiceId == g.choiceId } }?.choiceId)
            ?.let { cid -> return after.choices.firstOrNull { it.id == cid }?.fromNodeId }
        val e0 = before.effects.toSet()
        (after.effects.firstOrNull { it !in e0 } ?: before.effects.firstOrNull { it !in after.effects.toSet() })?.let { e ->
            return e.nodeId ?: after.choices.firstOrNull { it.id == e.choiceId }?.fromNodeId
        }
        return null
    }

    private fun JsonObject.s(k: String): String? = this[k]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.takeIf { it != "null" }
}
