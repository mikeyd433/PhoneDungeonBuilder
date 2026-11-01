package com.jackie.dungeon.story

/**
 * Where everything on the flowchart goes — derived, never stored (§0's second
 * rule), except for nudges the author made, which only offset it.
 *
 * Top to bottom. Layers by longest path from the entrance over FORWARD edges;
 * back edges (found with a DFS colour map, principle 2 — a depth compare
 * mistakes reconvergence for a loop) are drawn as a "↺ name" link under the
 * door instead of an arrow climbing the chart. Scenes nothing leads to sit in
 * a last row of their own. Order within a layer follows the doors above it.
 *
 * Units are abstract (the renderer scales them); a box is [W] wide and its
 * height grows with its doors.
 */
object FlowLayout {
    const val W = 236f
    const val GAP_X = 290f
    const val GAP_Y = 120f
    const val ROW = 26f
    const val HEADER = 50f
    const val TITLE_LINE = 17f
    const val BUTTONS = 36f
    const val TITLE_CHARS = 24
    const val LANE_GAP = 180f
    /** Between sub-chapter lanes inside one chapter. */
    const val SUB_GAP = 110f

    data class Box(val id: String, val x: Float, val y: Float, val h: Float, val titleLines: List<String>) {
        val cx get() = x + W / 2
        val bottom get() = y + h
    }

    sealed interface Edge {
        val choiceId: String
        val from: Pair<Float, Float>
        /** An arrow down to another scene. */
        data class Forward(override val choiceId: String, override val from: Pair<Float, Float>, val to: String, val fail: Boolean = false) : Edge
        /** "↺ name": a door back to a scene above. */
        data class Loop(override val choiceId: String, override val from: Pair<Float, Float>, val to: String, val fail: Boolean = false) : Edge
        /** A door that leads nowhere yet. */
        data class Nowhere(override val choiceId: String, override val from: Pair<Float, Float>) : Edge
        /** A fork: the diamond below the port, then yes and no. */
        data class Fork(override val choiceId: String, override val from: Pair<Float, Float>, val item: String, val yes: String?, val no: String?) : Edge
    }

    data class Port(val choiceId: String, val digit: String, val x: Float, val y: Float, val nowhere: Boolean)

    data class Layout(
        val boxes: Map<String, Box>,
        val ports: List<Port>,
        val edges: List<Edge>,
        val back: Set<String>,
        val unreachable: Set<String>,
        val width: Float,
        val height: Float,
        val minX: Float,
        /** A frame per chapter: its name and the area its scenes cover. */
        val chapters: List<Chapter> = emptyList(),
    )

    /** [name] is the full path, "Mike/Path A"; [label] is what the frame says. */
    data class Chapter(val name: String, val x0: Float, val y0: Float, val x1: Float, val y1: Float) {
        val label get() = name.substringAfterLast('/')
        val depth get() = name.split('/').size
    }

    /** "Mike / Path A" -> [Mike, Path A]: a chapter, and the sub-chapters inside it. */
    fun chapterPath(chapter: String?): List<String> = chapter?.split('/')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

    fun titleLines(title: String): List<String> {
        val t = title.ifBlank { "Untitled scene" }
        if (t.length <= TITLE_CHARS) return listOf(t)
        val cut = t.lastIndexOf(' ', TITLE_CHARS).takeIf { it > 0 } ?: TITLE_CHARS
        val rest = t.substring(cut).trim()
        return listOf(t.substring(0, cut), if (rest.length > TITLE_CHARS) rest.take(TITLE_CHARS - 1) + "…" else rest)
    }

    fun headerH(lines: Int) = HEADER + (lines - 1) * TITLE_LINE

    fun doorsOf(r: StoryRows, nodeId: String): List<ChoiceRow> =
        r.choices.filter { it.fromNodeId == nodeId }.sortedWith(compareBy({ keyOrder(it.digit) }, { it.sortOrder }))

    private fun keyOrder(d: String) = when (d) { "0" -> 10; "*" -> 11; "#" -> 12; else -> d.toIntOrNull() ?: 13 }

    fun boxHeight(r: StoryRows, n: NodeRow): Float {
        val doors = if (n.nodeType == "ending") 0 else doorsOf(r, n.id).size
        return headerH(titleLines(n.title.ifBlank { n.slug }).size) + doors * ROW + (if (doors > 0) 6f else 0f) + BUTTONS
    }

    /** Every place a door can lead: its destination, and a fork's other side. */
    private fun targets(r: StoryRows, c: ChoiceRow): List<Pair<String, Boolean>> {
        val out = ArrayList<Pair<String, Boolean>>()
        c.toNodeId?.let { out += it to false }
        r.gates.firstOrNull { it.choiceId == c.id && it.failBehavior == "divert" }?.failNodeId?.let { out += it to true }
        return out
    }

    /**
     * [nudges] are extra offsets on top of the ones stored in the rows (a box
     * or a lane moved by hand) — the flowchart passes the one being dragged.
     */
    fun layout(r: StoryRows, nudges: Map<String, Pair<Float, Float>> = emptyMap()): Layout {
        val ids = r.nodes.map { it.id }
        val known = ids.toSet()
        val colour = HashMap<String, Int>() // 1 = open, 2 = done
        val back = HashSet<String>()        // "choiceId>target"
        val order = ArrayList<String>()
        fun visit(u: String) {
            colour[u] = 1
            for (c in doorsOf(r, u)) for ((t, _) in targets(r, c)) {
                if (t !in known) continue
                when (colour[t]) { 1 -> back += "${c.id}>$t"; null -> visit(t); else -> Unit }
            }
            colour[u] = 2; order += u
        }
        r.story.rootNodeId?.takeIf { it in known }?.let(::visit)
        val reach = order.toSet()
        order.reverse()
        val depth = HashMap<String, Int>()
        r.story.rootNodeId?.let { if (it in reach) depth[it] = 0 }
        for (u in order) for (c in doorsOf(r, u)) for ((t, _) in targets(r, c)) {
            if ("${c.id}>$t" in back || t !in reach) continue
            depth[t] = maxOf(depth[t] ?: 0, (depth[u] ?: 0) + 1)
        }
        val layers = ArrayList<MutableList<String>>()
        for (u in order) { val d = depth[u] ?: 0; while (layers.size <= d) layers += ArrayList<String>(); layers[d] += u }
        val loose = ids.filter { it !in reach }
        if (loose.isNotEmpty()) layers += loose.toMutableList()

        val nodeById = r.nodes.associateBy { it.id }
        val pos = HashMap<String, Pair<Float, Float>>() // centre x, top y
        fun bary(u: String): Float {
            val xs = r.choices.filter { c -> targets(r, c).any { it.first == u } && pos[c.fromNodeId] != null }
                .map { c -> pos[c.fromNodeId]!!.first + (keyOrder(c.digit) - 1) * 20f }
            return if (xs.isEmpty()) 0f else xs.average().toFloat()
        }
        // Chapters are LANES: each one its own vertical band, never mixed with
        // another, so two storylines that run side by side read as two columns.
        // A sub-chapter ("Mike/Path A") is a lane INSIDE its chapter's lane, so
        // the scenes in it are still Mike's. Lanes go left to right in the order
        // the story first reaches them.
        //
        // A row where every scene of a chapter sits in that chapter itself (no
        // sub-chapter) spans the chapter's whole lane, centred — the entrance
        // above everything, Mike's intro above Mike's two paths — rather than
        // being given a narrow lane of its own off to one side. Where a row mixes
        // the two, the chapter's own scenes get an unnamed lane beside its
        // sub-chapters.
        val pathOf = HashMap<String, List<String>>()
        for (u in ids) pathOf[u] = chapterPath(nodeById[u]?.chapter)
        val lanes = pathOf.values.any { it.isNotEmpty() }
        val OWN = "\u0000"
        fun key(p: List<String>) = p.joinToString("/")
        // The tree: each chapter path's children, in first-reached order.
        val children = LinkedHashMap<String, MutableList<String>>()
        fun kids(k: String) = children.getOrPut(k) { ArrayList() }
        val laid = layers.flatten()
        for (u in laid) {
            val p = pathOf[u]!!
            for (d in 0 until p.size) { val parent = key(p.take(d)); val child = key(p.take(d + 1)); if (child !in kids(parent)) kids(parent) += child }
        }
        fun depthOf(k: String) = if (k.isEmpty()) 0 else k.split('/').size
        fun under(u: String, k: String): Boolean { val p = pathOf[u]!!; val d = depthOf(k); return p.size >= d && key(p.take(d)) == k }
        fun exact(u: String, k: String) = key(pathOf[u]!!) == k
        // Rows that mix a chapter's own scenes with its sub-chapters' give it an own-scenes lane.
        for (layer in layers) for (k in children.keys.toList()) {
            val m = layer.filter { under(it, k) }
            if (m.any { exact(it, k) } && m.any { !exact(it, k) } && "$k/$OWN" !in kids(k)) kids(k).add(0, "$k/$OWN")
        }
        fun gapOf(k: String) = if (k.isEmpty()) LANE_GAP else SUB_GAP
        val widthMemo = HashMap<String, Float>()
        fun width(k: String): Float = widthMemo.getOrPut(k) {
            val isOwn = k.endsWith(OWN)
            val parent = if (isOwn) k.removeSuffix("/$OWN") else k
            val own = layers.maxOfOrNull { layer ->
                val m = layer.filter { under(it, parent) }
                when {
                    isOwn -> m.count { exact(it, parent) }
                    m.isNotEmpty() && m.all { exact(it, parent) } -> m.size
                    else -> 0
                }
            } ?: 0
            val ks = if (isOwn) emptyList() else children[k].orEmpty()
            val sub = if (ks.isEmpty()) 0f else ks.sumOf { width(it).toDouble() }.toFloat() + gapOf(k) * (ks.size - 1)
            maxOf(sub, if (own > 0) (own - 1) * GAP_X + W else 0f, W)
        }
        val left = HashMap<String, Float>()
        fun place(k: String, x0: Float) {
            left[k] = x0
            val ks = if (k.endsWith(OWN)) emptyList() else children[k].orEmpty()
            if (ks.isEmpty()) return
            val total = ks.sumOf { width(it).toDouble() }.toFloat() + gapOf(k) * (ks.size - 1)
            var x = x0 + (width(k) - total) / 2
            for (c in ks) { place(c, x); x += width(c) + gapOf(k) }
        }
        if (lanes) place("", 0f)

        var y = 0f
        for (layer in layers) {
            if (layer.isEmpty()) continue
            var splitsBelow = false
            fun row(group: List<String>, k: String) {
                val sorted = group.map { it to bary(it) }.sortedBy { it.second }
                val centre = left[k]!! + width(k) / 2
                sorted.forEachIndexed { i, (u, _) -> pos[u] = (centre + (i - (sorted.size - 1) / 2f) * GAP_X) to y }
            }
            fun into(k: String, members: List<String>) {
                if (members.isEmpty()) return
                if (members.all { exact(it, k) }) {
                    if (children[k].orEmpty().isNotEmpty()) splitsBelow = true
                    return row(members, k)
                }
                val own = members.filter { exact(it, k) }
                if (own.isNotEmpty()) row(own, "$k/$OWN")
                for (c in children[k].orEmpty()) if (!c.endsWith(OWN)) into(c, members.filter { under(it, c) })
            }
            if (!lanes) {
                val sorted = layer.map { it to bary(it) }.sortedBy { it.second }
                val centre = sorted.map { it.second }.average().toFloat()
                sorted.forEachIndexed { i, (u, _) -> pos[u] = (centre + (i - (sorted.size - 1) / 2f) * GAP_X) to y }
            } else into("", layer)
            // Room under a row that spans lanes, for the chapter names on the frames below it.
            y += layer.maxOf { boxHeight(r, nodeById[it]!!) } + GAP_Y + (if (splitsBelow) 90f else 0f)
        }

        val boxes = LinkedHashMap<String, Box>()
        for (n in r.nodes) {
            val (cx, top) = pos[n.id] ?: continue
            val (ex, ey) = nudges[n.id] ?: (0f to 0f)
            // Moving a chapter moves its sub-chapters too: every enclosing lane's move adds up.
            var dx = n.nudgeX + ex; var dy = n.nudgeY + ey
            val p = chapterPath(n.chapter)
            for (d in 1..p.size) {
                val k = p.take(d).joinToString("/")
                r.story.laneNudges[k]?.let { dx += it.getOrElse(0) { 0f }; dy += it.getOrElse(1) { 0f } }
                nudges["chapter:$k"]?.let { dx += it.first; dy += it.second }
            }
            boxes[n.id] = Box(n.id, cx - W / 2 + dx, top + dy, boxHeight(r, n), titleLines(n.title.ifBlank { n.slug }))
        }

        val ports = ArrayList<Port>()
        val edges = ArrayList<Edge>()
        for (n in r.nodes) {
            if (n.nodeType == "ending") continue
            val b = boxes[n.id] ?: continue
            val doors = doorsOf(r, n.id)
            doors.forEachIndexed { i, c ->
                val px = b.x + W * (i + 1) / (doors.size + 1)
                val py = b.bottom
                ports += Port(c.id, c.digit, px, py, c.toNodeId == null)
                val from = px to py
                val isBack = { t: String -> "${c.id}>$t" in back || (depth[t] ?: Int.MAX_VALUE) <= (depth[n.id] ?: 0) }
                val gate = r.gates.firstOrNull { it.choiceId == c.id }
                when {
                    c.toNodeId == null -> edges += Edge.Nowhere(c.id, from)
                    gate != null && gate.failBehavior == "divert" ->
                        edges += Edge.Fork(c.id, from, StoryEditor.need(r, c.id)?.let { StoryEditor.needWords(r, it) } ?: StoryEditor.describe(gate.expression), c.toNodeId.takeIf { it in boxes }, gate.failNodeId?.takeIf { it in boxes })
                    c.toNodeId !in boxes -> edges += Edge.Nowhere(c.id, from)
                    isBack(c.toNodeId) -> edges += Edge.Loop(c.id, from, c.toNodeId)
                    else -> edges += Edge.Forward(c.id, from, c.toNodeId)
                }
            }
        }
        val minX = boxes.values.minOfOrNull { it.x } ?: 0f
        val maxX = boxes.values.maxOfOrNull { it.x + W } ?: W
        val maxY = boxes.values.maxOfOrNull { it.bottom } ?: 0f
        // A frame per chapter and per sub-chapter; an outer frame stands a step
        // further out than the frames inside it, so they nest rather than touch.
        val members = LinkedHashMap<String, MutableList<Box>>()
        for (n in r.nodes) {
            val b = boxes[n.id] ?: continue
            val p = chapterPath(n.chapter)
            for (d in 1..p.size) members.getOrPut(p.take(d).joinToString("/")) { ArrayList() } += b
        }
        val deepest = members.keys.associateWith { k -> members.keys.filter { it == k || it.startsWith("$k/") }.maxOf { it.split('/').size } - k.split('/').size }
        val chapters = members.map { (name, bs) ->
            val step = deepest[name]!!
            Chapter(name, bs.minOf { it.x } - 30f - 24f * step, bs.minOf { it.y } - 50f - 34f * step, bs.maxOf { it.x + W } + 30f + 24f * step, bs.maxOf { it.bottom } + 70f + 24f * step)
        }
        return Layout(boxes, ports, edges, back, loose.toSet(), maxX - minX, maxY + 80f, minX, chapters)
    }

    /** Is this door a loop back up the story? (For the "↺" mark in its row.) */
    fun isLoop(l: Layout, r: StoryRows, c: ChoiceRow): Boolean = l.edges.any { it.choiceId == c.id && it is Edge.Loop }
}
