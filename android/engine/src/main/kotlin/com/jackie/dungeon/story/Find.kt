package com.jackie.dungeon.story

/**
 * The editor's FIND, like a browser's: every place some words appear in a
 * story — scene names, scripts, choice names, replies and refusals — in the
 * order you'd come across them on the flowchart (top to bottom, then left to
 * right), so ▼ walks down the map. Case doesn't matter; every occurrence
 * counts, as it does in a browser, so "3 of 12" means the twelfth sighting,
 * not the twelfth scene.
 */
object Find {
    enum class Where(val label: String) { TITLE("scene name"), SCRIPT("script"), CHOICE("choice name"), REPLY("reply"), REFUSAL("refusal") }

    /** One sighting: [text] is the whole field it's in, and the words are at [start] until [end]. */
    data class Hit(val nodeId: String, val choiceId: String?, val where: Where, val text: String, val start: Int, val end: Int)

    fun find(rows: StoryRows, query: String, layout: FlowLayout.Layout? = null): List<Hit> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val out = ArrayList<Hit>()
        fun scan(nodeId: String, choiceId: String?, where: Where, text: String?) {
            if (text.isNullOrEmpty()) return
            var i = text.indexOf(q, ignoreCase = true)
            while (i >= 0) { out += Hit(nodeId, choiceId, where, text, i, i + q.length); i = text.indexOf(q, i + q.length, ignoreCase = true) }
        }
        for (n in order(rows, layout)) {
            scan(n.id, null, Where.TITLE, n.title)
            scan(n.id, null, Where.SCRIPT, n.narration)
            for (c in FlowLayout.doorsOf(rows, n.id)) {
                scan(n.id, c.id, Where.CHOICE, c.label)
                scan(n.id, c.id, Where.REPLY, c.reactionNarration)
                scan(n.id, c.id, Where.REFUSAL, rows.gates.firstOrNull { it.choiceId == c.id }?.failNarration)
            }
        }
        return out
    }

    /** Scenes top to bottom, then left to right, as the flowchart shows them; any it doesn't place go last. */
    fun order(rows: StoryRows, layout: FlowLayout.Layout?): List<NodeRow> {
        val boxes = layout?.boxes ?: return rows.nodes
        val placed = rows.nodes.filter { it.id in boxes }.sortedWith(compareBy({ boxes[it.id]!!.y }, { boxes[it.id]!!.x }))
        return placed + rows.nodes.filter { it.id !in boxes }
    }

    /** Where [query] sits in [text] (case ignored), as start..end pairs, for highlighting. */
    fun spans(text: String, query: String): List<IntRange> {
        val q = query.trim()
        if (q.isEmpty() || text.isEmpty()) return emptyList()
        val out = ArrayList<IntRange>()
        var i = text.indexOf(q, ignoreCase = true)
        while (i >= 0) { out += i until i + q.length; i = text.indexOf(q, i + q.length, ignoreCase = true) }
        return out
    }

    /** A line of context around a hit, about [width] characters, with where the words now sit in it. */
    fun snippet(h: Hit, width: Int = 60): Triple<String, Int, Int> {
        val flat = h.text.replace('\n', ' ')
        val len = h.end - h.start
        val before = ((width - len) / 2).coerceAtLeast(8)
        val from = (h.start - before).coerceAtLeast(0)
        val to = (from + width).coerceAtMost(flat.length).coerceAtLeast(h.end)
        val lead = if (from > 0) "…" else ""
        val tail = if (to < flat.length) "…" else ""
        return Triple(lead + flat.substring(from, to) + tail, lead.length + h.start - from, lead.length + h.end - from)
    }
}
