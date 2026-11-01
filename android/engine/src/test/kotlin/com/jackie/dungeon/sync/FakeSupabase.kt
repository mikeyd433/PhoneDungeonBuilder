package com.jackie.dungeon.sync

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URLDecoder
import java.time.Instant

/**
 * Just enough of Supabase to hold the sync to the real one's rules: the
 * PostgREST calls the client makes, the parts of the schema that bite (unique
 * slugs per story, foreign keys, the divert check, uniform upsert keys, the
 * owner on a new story) and migration 0022's `edited_at` bump on any change.
 */
class FakeSupabase(var clock: Instant = Instant.parse("2026-11-01T12:00:00Z")) : Http {
    val tables = HashMap<String, MutableList<JsonObject>>()
    val files = HashMap<String, ByteArray>()
    val user = "11111111-1111-4111-8111-111111111111"
    val friend = "22222222-2222-4222-8222-222222222222"
    /** Accounts that exist: email -> id. */
    val accounts = mutableMapOf("me@example.com" to user, "friend@example.com" to friend)
    /** Live tokens -> the account they belong to. */
    val tokens = HashMap<String, Pair<String, String>>()
    var calls = 0
    private val json = Json

    fun t(name: String) = tables.getOrPut(name) { ArrayList() }
    fun tick(): String { clock = clock.plusSeconds(1); return clock.toString() }

    /** As if the web app edited a story: the trigger bumps edited_at. */
    fun bump(storyId: String) = setRow("stories", storyId, mapOf("edited_at" to JsonPrimitive(tick())))

    fun setRow(table: String, id: String, change: Map<String, JsonElement>) {
        val l = t(table); val i = l.indexOfFirst { it.s("id") == id }
        l[i] = JsonObject(l[i] + change)
    }

    override fun send(r: Request): Response {
        calls++
        val path = r.url.substringAfter("https://x.supabase.co").substringBefore('?')
        val query = r.url.substringAfter('?', "")
        val body = r.body?.decodeToString()
        if (path.startsWith("/storage/v1/object/story-audio/")) {
            files[URLDecoder.decode(path.removePrefix("/storage/v1/object/story-audio/"), "UTF-8")] = r.body!!
            return Response(200, "{}")
        }
        return when (path) {
            "/auth/v1/otp" -> Response(200, "{}")
            "/auth/v1/verify" -> if (r.method == "GET") {
                check(!r.followRedirects) { "the link must not be followed into a browser page" }
                lastToken = "token-link"; tokens["token-link"] = user to "me@example.com"
                if ("token=good" in r.url) Response(303, "", mapOf("Location" to "https://dabingabongo.com/delve#access_token=token-link&expires_at=${clock.epochSecond + 3600}&expires_in=3600&refresh_token=r-link&token_type=bearer&type=magiclink"))
                else Response(303, "", mapOf("Location" to "https://dabingabongo.com/delve#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"))
            } else {
                val o = json.parseToJsonElement(body!!).jsonObject
                val email = o.s("email") ?: "me@example.com"
                if (o.s("token") != "123456") Response(403, """{"msg":"Token has expired or is invalid"}""")
                else if (email == "me@example.com") Response(200, session("first"))
                else Response(200, session("as-$email", email))
            }
            "/auth/v1/token" -> Response(200, session("refreshed"))
            // The emailed link: a redirect carrying the session in the fragment.
            "/auth/v1/verify" + "-link" -> Response(500, "")
            "/auth/v1/user" -> tokens[r.headers["Authorization"]?.removePrefix("Bearer ")]?.let { (id, email) -> Response(200, """{"id":"$id","email":"$email"}""") } ?: Response(401, """{"msg":"invalid JWT"}""")
            else -> rest(r.method, path.removePrefix("/rest/v1/"), query, body, r.headers)
        }
    }

    var lastToken = ""
    private fun session(tag: String, email: String = "me@example.com"): String {
        val id = accounts.getOrPut(email) { java.util.UUID.nameUUIDFromBytes(email.toByteArray()).toString() }
        if (email == "me@example.com") lastToken = "token-$tag"
        tokens["token-$tag"] = id to email
        return """{"access_token":"token-$tag","refresh_token":"r-$tag","expires_in":3600,"expires_at":${clock.epochSecond + 3600},"user":{"id":"$id","email":"$email"}}"""
    }

    fun role(story: String?, who: String): String? = t("memberships").firstOrNull { it.s("story_id") == story && it.s("user_id") == who }?.s("role")

    private fun rest(method: String, table: String, query: String, body: String?, headers: Map<String, String>): Response {
        val (me, myEmail) = tokens[headers["Authorization"]?.removePrefix("Bearer ")] ?: return Response(401, """{"message":"JWT expired"}""")
        if (table.startsWith("rpc/")) return rpc(table.removePrefix("rpc/"), json.parseToJsonElement(body ?: "{}").jsonObject, me, myEmail)
        // Row Level Security, roughly: you see a story's rows if you're on it; viewers can't write.
        fun visible(o: JsonObject) = table == "memberships" || role(if (table == "stories") o.s("id") else o.s("story_id"), me) != null
        if (method != "GET" && table != "stories" && table != "memberships") {
            val sid = (if (body != null && body.trimStart().startsWith("[")) (json.parseToJsonElement(body) as JsonArray).firstOrNull()?.jsonObject?.s("story_id") else null)
                ?: t(table).firstOrNull { o -> query.contains(o.s("id") ?: "-") }?.s("story_id")
            if (sid != null && role(sid, me) == "viewer") return Response(403, """{"message":"new row violates row-level security policy"}""")
        }
        val params = query.split('&').filter { it.isNotEmpty() }.associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        fun match(o: JsonObject) = params.all { (k, v) ->
            when {
                k in setOf("select", "order", "on_conflict") -> true
                v.startsWith("eq.") -> o.s(k) == v.removePrefix("eq.")
                v.startsWith("in.(") -> o.s(k) in v.removePrefix("in.(").removeSuffix(")").split(',')
                else -> true
            }
        }
        val rows = t(table)
        return when (method) {
            "GET" -> {
                val cols = params["select"]?.takeIf { it != "*" }?.split(',')
                // Ordered as timestamps, as Postgres does — not as strings.
                val found = rows.filter(::match).filter(::visible).sortedWith(compareBy({ it.s("created_at")?.let(Instant::parse) }, { it.s("id") }))
                Response(200, JsonArray(found.map { o -> if (cols == null) o else JsonObject(o.filterKeys { it in cols }) }).toString())
            }
            "POST" -> {
                val incoming = (json.parseToJsonElement(body!!) as JsonArray).map { it.jsonObject }
                if (incoming.map { it.keys }.toSet().size > 1) return Response(400, """{"message":"All object keys must match"}""")
                val merge = params["on_conflict"] == "id"
                for (o in incoming) {
                    check(table, o)?.let { return it }
                    val i = rows.indexOfFirst { it.s("id") == o.s("id") }
                    if (i >= 0 && !merge) return Response(409, """{"message":"duplicate key value violates unique constraint \"${table}_pkey\""}""")
                    if (table == "stories" && i < 0 && o.s("owner_id") != me) return Response(403, """{"message":"new row violates row-level security policy"}""")
                    if (table == "stories" && i < 0) t("memberships") += obj("story_id" to o.s("id"), "user_id" to me, "role" to "owner")
                    val withDefaults = if (i < 0) JsonObject(defaults(table) + o) else JsonObject(rows[i] + o)
                    if (i >= 0) rows[i] = withDefaults else rows += withDefaults
                    unique(table, withDefaults)?.let { return it }
                }
                touched(table, incoming)
                Response(201, "")
            }
            "PATCH" -> {
                val change = json.parseToJsonElement(body!!).jsonObject
                val hit = ArrayList<JsonObject>()
                for (i in rows.indices) if (match(rows[i])) { rows[i] = JsonObject(rows[i] + change); unique(table, rows[i])?.let { return it }; hit += rows[i] }
                if (table == "stories") hit.replaceAll { o -> JsonObject(o + ("edited_at" to JsonPrimitive(tick()))).also { n -> rows[rows.indexOfFirst { it.s("id") == n.s("id") }] = n } }
                else touched(table, hit)
                Response(200, JsonArray(hit).toString())
            }
            "DELETE" -> {
                val gone = rows.filter(::match)
                rows.removeAll(gone.toSet())
                cascade(table, gone.mapNotNull { it.s("id") }.toSet())
                touched(table, gone)
                Response(204, "")
            }
            else -> Response(405, "")
        }
    }

    val invites = ArrayList<Triple<String, String, String>>() // story, email, role

    private fun rpc(name: String, a: JsonObject, me: String, myEmail: String): Response {
        fun ok(v: String) = Response(200, v)
        val story = a.s("p_story")
        return when (name) {
            "accept_story_invites" -> {
                val mine = invites.filter { it.second == myEmail }
                for ((st, _, role) in mine) if (role(st, me) == null) t("memberships") += obj("story_id" to st, "user_id" to me, "role" to role)
                invites.removeAll(mine.toSet()); ok("${mine.size}")
            }
            "invite_to_story" -> {
                if (role(story, me) != "owner") return Response(400, """{"message":"Only the story's owner can share it."}""")
                val email = a.s("p_email")!!.trim().lowercase(); val r = a.s("p_role") ?: "writer"
                val id = accounts[email]
                if (id != null) { t("memberships").removeAll { it.s("story_id") == story && it.s("user_id") == id }; t("memberships") += obj("story_id" to story, "user_id" to id, "role" to r); ok("\"added\"") }
                else { invites.removeAll { it.first == story && it.second == email }; invites += Triple(story!!, email, r); ok("\"invited\"") }
            }
            "story_members" -> ok(JsonArray(t("memberships").filter { it.s("story_id") == story }.map { m ->
                obj("user_id" to m.s("user_id"), "email" to accounts.entries.first { it.value == m.s("user_id") }.key, "role" to m.s("role"), "pending" to false)
            } + invites.filter { it.first == story }.map { obj("user_id" to null, "email" to it.second, "role" to it.third, "pending" to true) }).toString())
            "remove_story_member" -> { t("memberships").removeAll { it.s("story_id") == story && it.s("user_id") == a.s("p_user") && it.s("role") != "owner" }; ok("") }
            "cancel_story_invite" -> { invites.removeAll { it.first == story && it.second == a.s("p_email") }; ok("") }
            "leave_story" -> { t("memberships").removeAll { it.s("story_id") == story && it.s("user_id") == me }; ok("") }
            else -> Response(404, """{"message":"function not found"}""")
        }
    }

    private fun defaults(table: String): Map<String, JsonElement> = when (table) {
        "stories" -> mapOf("edited_at" to JsonPrimitive(tick()), "created_at" to JsonPrimitive(clock.toString()))
        "nodes" -> mapOf("room_design" to JsonPrimitive("stone"))
        else -> emptyMap()
    } + mapOf("created_at" to JsonPrimitive(clock.toString()))

    private fun check(table: String, o: JsonObject): Response? {
        fun exists(t: String, id: String?) = id == null || t(t).any { it.s("id") == id }
        fun fk(ok: Boolean, what: String) = if (ok) null else Response(409, """{"message":"insert or update on table \"$table\" violates foreign key constraint ($what)"}""")
        return when (table) {
            "nodes" -> fk(exists("stories", o.s("story_id")), "story")
            "choices" -> fk(exists("nodes", o.s("from_node_id")) && o.s("from_node_id") != null && exists("nodes", o.s("to_node_id")), "nodes")
            "gates" -> fk(exists("choices", o.s("choice_id")), "choice")
                ?: if (o.s("fail_behavior") == "divert" && o.s("fail_node_id") == null) Response(400, """{"message":"violates check constraint gates_divert_needs_target"}""") else null
            "effects" -> fk(exists("state_vars", o.s("state_var_id")) && exists("choices", o.s("choice_id")) && exists("nodes", o.s("node_id")), "effect owner")
            "dialogue_lines" -> fk(exists("characters", o.s("character_id")) && exists("nodes", o.s("node_id")) && exists("choices", o.s("choice_id")), "line owner")
            else -> null
        }
    }

    private fun unique(table: String, o: JsonObject): Response? {
        if (table !in setOf("nodes", "state_vars", "characters")) return null
        val clash = t(table).count { it.s("story_id") == o.s("story_id") && it.s("slug") == o.s("slug") } > 1
        return if (clash) Response(409, """{"message":"duplicate key value violates unique constraint \"${table}_story_id_slug_key\""}""") else null
    }

    private fun cascade(table: String, ids: Set<String>) {
        if (ids.isEmpty()) return
        when (table) {
            "stories" -> tables.forEach { (n, l) -> if (n != "stories") l.removeAll { it.s("story_id") in ids } }
            "nodes" -> {
                val doors = t("choices").filter { it.s("from_node_id") in ids }.mapNotNull { it.s("id") }.toSet()
                t("choices").removeAll { it.s("id") in doors }
                cascade("choices", doors)
                t("choices").replaceAll { if (it.s("to_node_id") in ids) JsonObject(it + ("to_node_id" to JsonNull)) else it }
            }
            "choices" -> { t("gates").removeAll { it.s("choice_id") in ids }; t("effects").removeAll { it.s("choice_id") in ids } }
        }
    }

    private fun touched(table: String, rows: List<JsonObject>) {
        if (table == "stories") return
        for (sid in rows.mapNotNull { it.s("story_id") }.toSet()) if (t("stories").any { it.s("id") == sid }) bump(sid)
    }

    fun storyEdited(id: String) = t("stories").first { it.s("id") == id }.s("edited_at")!!

    companion object {
        fun JsonObject.s(k: String): String? = this[k]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
        fun obj(vararg kv: Pair<String, Any?>) = buildJsonObject { for ((k, v) in kv) when (v) { null -> put(k, JsonNull); is String -> put(k, v); is Number -> put(k, v); is Boolean -> put(k, v) } }
    }
}
