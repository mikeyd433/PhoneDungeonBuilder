package com.jackie.dungeon.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** One HTTP exchange. The app sends it with HttpURLConnection; tests answer it themselves. */
fun interface Http {
    fun send(r: Request): Response
}

data class Request(val method: String, val url: String, val headers: Map<String, String>, val body: ByteArray? = null, val followRedirects: Boolean = true)
data class Response(val code: Int, val body: String, val headers: Map<String, String> = emptyMap())

/** Something went wrong talking to Supabase, in words the author can act on. */
class SyncError(message: String, val code: Int = 0) : Exception(message)

/** Who is signed in. Kept by the app between runs; refreshed here before it runs out. */
@Serializable
data class Session(
    val accessToken: String,
    val refreshToken: String,
    /** Epoch seconds. */
    val expiresAt: Long,
    val userId: String,
    val email: String,
)

/**
 * The few parts of Supabase the phone uses: email-code sign-in (GoTrue),
 * reading and writing table rows (PostgREST, under the signed-in user, so Row
 * Level Security decides what is allowed exactly as it does for the web app),
 * and uploading takes to the public `story-audio` bucket.
 */
class Supabase(
    val url: String,
    private val key: String,
    private val http: Http,
    var session: Session? = null,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
    /** Told whenever a refresh replaced the session, so the app can keep it. */
    private val onSession: (Session?) -> Unit = {},
) {
    private val base = url.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    // ---- signing in -----------------------------------------------------------

    /**
     * Email a sign-in link (and, if the project's email template carries
     * `{{ .Token }}`, a code). Only for an account that already exists — the
     * web app's. The link comes back to [redirectTo] when that address is on
     * the project's Redirect URLs list; otherwise it goes to the web app, and
     * the link can be pasted into the phone instead ([signInWithLink]).
     */
    fun sendCode(email: String, redirectTo: String? = null) {
        val body = buildJsonObject { put("email", email.trim()); put("create_user", false) }
        val q = redirectTo?.let { "?redirect_to=" + URLEncoder.encode(it, "UTF-8") } ?: ""
        call("POST", "/auth/v1/otp$q", body.toString(), auth = false)
    }

    /**
     * Signed in by the link in the email: [url] is either where the link landed
     * (`jackiedungeon://login#access_token=…`), or the emailed link itself
     * (`https://…supabase.co/auth/v1/verify?token=…`), which is followed one
     * step to read where it would have sent the browser.
     */
    fun signInWithLink(url: String): Session {
        var landing = url.trim()
        if ("/auth/v1/verify" in landing) {
            val r = http.send(Request("GET", landing, mapOf("apikey" to key), followRedirects = false))
            landing = r.headers.entries.firstOrNull { it.key.equals("location", true) }?.value
                ?: throw SyncError(if (r.code in 200..299) "That link didn't sign in." else explain(r), r.code)
        }
        val params = (landing.substringAfter('#', "") + "&" + landing.substringAfter('?', "").substringBefore('#'))
            .split('&').filter { '=' in it }.associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        params["error_description"]?.let { throw SyncError(it.replace('+', ' ') + " Send a new link and use that one.") }
        val access = params["access_token"] ?: throw SyncError("That isn't a sign-in link.")
        val r = http.send(Request("GET", "$base/auth/v1/user", mapOf("apikey" to key, "Authorization" to "Bearer $access")))
        if (r.code !in 200..299) throw SyncError(explain(r), r.code)
        val user = json.parseToJsonElement(r.body).jsonObject
        val s = Session(
            accessToken = access,
            refreshToken = params["refresh_token"] ?: "",
            expiresAt = params["expires_at"]?.toLongOrNull() ?: (now() + (params["expires_in"]?.toLongOrNull() ?: 3600)),
            userId = user.str("id") ?: "",
            email = user.str("email") ?: "",
        )
        session = s
        onSession(s)
        return s
    }

    /** Swap the emailed code for a session. */
    fun verify(email: String, code: String): Session {
        val body = buildJsonObject { put("type", "email"); put("email", email.trim()); put("token", code.trim()) }
        return keep(call("POST", "/auth/v1/verify", body.toString(), auth = false))
    }

    fun signOut() { session = null; onSession(null) }

    private fun refresh(s: Session): Session {
        val body = buildJsonObject { put("refresh_token", s.refreshToken) }
        return keep(call("POST", "/auth/v1/token?grant_type=refresh_token", body.toString(), auth = false))
    }

    private fun keep(text: String): Session {
        val o = json.parseToJsonElement(text).jsonObject
        val user = o["user"]?.jsonObject ?: throw SyncError("Sign-in didn't return an account.")
        val expiresIn = o["expires_in"]?.jsonPrimitive?.long ?: 3600
        val s = Session(
            accessToken = o.str("access_token") ?: throw SyncError("Sign-in didn't return a token."),
            refreshToken = o.str("refresh_token") ?: "",
            expiresAt = o["expires_at"]?.jsonPrimitive?.long ?: (now() + expiresIn),
            userId = user.str("id") ?: "",
            email = user.str("email") ?: "",
        )
        session = s
        onSession(s)
        return s
    }

    private fun token(): String {
        var s = session ?: throw SyncError("Not signed in.", 401)
        if (s.expiresAt - now() < 60) s = refresh(s)
        return s.accessToken
    }

    // ---- rows ----------------------------------------------------------------------

    /** `GET /rest/v1/<table>?<query>` — query already PostgREST syntax. */
    fun select(table: String, query: String): JsonArray =
        json.parseToJsonElement(call("GET", "/rest/v1/$table?$query", null)) as JsonArray

    /** Insert or update by id. Every object must carry the same keys (PostgREST requires it). */
    fun upsert(table: String, rows: List<JsonObject>) {
        if (rows.isEmpty()) return
        for (chunk in rows.chunked(200))
            call("POST", "/rest/v1/$table?on_conflict=id", JsonArray(chunk).toString(), prefer = "resolution=merge-duplicates,return=minimal")
    }

    /** A plain insert (a new story: the upsert path would need to read a row the new owner can't see yet). */
    fun insert(table: String, rows: List<JsonObject>) {
        if (rows.isEmpty()) return
        call("POST", "/rest/v1/$table", JsonArray(rows).toString(), prefer = "return=minimal")
    }

    fun patch(table: String, query: String, body: JsonObject): JsonArray =
        json.parseToJsonElement(call("PATCH", "/rest/v1/$table?$query", body.toString(), prefer = "return=representation")) as JsonArray

    fun delete(table: String, ids: Collection<String>) {
        for (chunk in ids.toList().chunked(80)) call("DELETE", "/rest/v1/$table?id=in.(${chunk.joinToString(",")})", null, prefer = "return=minimal")
    }

    // ---- takes --------------------------------------------------------------------

    /** Upload (or replace) one take at `story-audio/<path>`; `path` starts with the story's id. */
    fun upload(path: String, bytes: ByteArray, contentType: String = "audio/wav") {
        val enc = path.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val r = http.send(Request("POST", "$base/storage/v1/object/story-audio/$enc", headers(true) + mapOf("Content-Type" to contentType, "x-upsert" to "true"), bytes))
        if (r.code !in 200..299) throw SyncError(explain(r), r.code)
    }

    // ---- plumbing ------------------------------------------------------------------

    private fun headers(auth: Boolean): Map<String, String> = buildMap {
        put("apikey", key)
        put("Authorization", "Bearer " + if (auth) token() else key)
    }

    private fun call(method: String, path: String, body: String?, auth: Boolean = true, prefer: String? = null): String {
        val h = headers(auth).toMutableMap()
        if (body != null) h["Content-Type"] = "application/json"
        if (prefer != null) h["Prefer"] = prefer
        val r = http.send(Request(method, base + path, h, body?.toByteArray()))
        if (r.code !in 200..299) throw SyncError(explain(r), r.code)
        return r.body.ifEmpty { "[]" }
    }

    private fun explain(r: Response): String {
        val detail = runCatching {
            val o = json.parseToJsonElement(r.body).jsonObject
            listOfNotNull(o.str("msg"), o.str("message"), o.str("error_description"), o.str("error"), o.str("details"), o.str("hint")).distinct().joinToString(" · ")
        }.getOrNull()?.ifBlank { null } ?: r.body.take(200)
        return when (r.code) {
            401, 403 -> "Not allowed ($detail). Try signing in again."
            0 -> "No connection."
            else -> "Supabase said ${r.code}: $detail"
        }
    }

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonElement)?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.takeIf { it != "null" }
}
