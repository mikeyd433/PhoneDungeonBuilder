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

    data class Chapter(val name: String, val x0: Float, val y0: Float, val x1: Float, val y1: Float)

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
        // Lanes go left to right in the order the story first reaches them;
        // scenes in no chapter share an unnamed lane of their own.
        val lane = { u: String -> nodeById[u]?.chapter?.takeIf { it.isNotBlank() } ?: "" }
        val inLanes = layers.filterNot { layer -> layer.all { lane(it).isEmpty() } }.flatten()
        val laneOrder = inLanes.map(lane).distinct().ifEmpty { listOf("") }
        val lanes = laneOrder.size > 1 || laneOrder.firstOrNull()?.isNotEmpty() == true
        val laneWidth = laneOrder.associateWith { l -> layers.filterNot { layer -> layer.all { lane(it).isEmpty() } }.maxOfOrNull { layer -> layer.count { lane(it) == l } }?.coerceAtLeast(1).let { ((it ?: 1) - 1) * GAP_X + W } }
        val laneLeft = HashMap<String, Float>()
        run { var x = 0f; for (l in laneOrder) { laneLeft[l] = x; x += laneWidth[l]!! + LANE_GAP } }
        val totalWidth = laneOrder.sumOf { laneWidth[it]!!.toDouble() }.toFloat() + LANE_GAP * (laneOrder.size - 1).coerceAtLeast(0)
        var y = 0f
        for (layer in layers) {
            if (layer.isEmpty()) continue
            // A row with no chaptered scene in it — the entrance before the story
            // splits, the scenes nothing leads to — spans every lane, centred,
            // rather than sitting in a lane of its own off to one side.
            val trunk = lanes && layer.all { lane(it).isEmpty() }
            if (trunk) {
                val sorted = layer.map { it to bary(it) }.sortedBy { it.second }
                sorted.forEachIndexed { i, (u, _) -> pos[u] = (totalWidth / 2 + (i - (sorted.size - 1) / 2f) * GAP_X) to y }
            } else if (!lanes) {
                val sorted = layer.map { it to bary(it) }.sortedBy { it.second }
                val centre = sorted.map { it.second }.average().toFloat()
                sorted.forEachIndexed { i, (u, _) -> pos[u] = (centre + (i - (sorted.size - 1) / 2f) * GAP_X) to y }
            } else for ((l, inLane) in layer.groupBy(lane)) {
                val sorted = inLane.map { it to bary(it) }.sortedBy { it.second }
                val centre = laneLeft[l]!! + laneWidth[l]!! / 2
                sorted.forEachIndexed { i, (u, _) -> pos[u] = (centre + (i - (sorted.size - 1) / 2f) * GAP_X) to y }
            }
            // Room under a spanning row for the chapter names on the frames below it.
            y += layer.maxOf { boxHeight(r, nodeById[it]!!) } + GAP_Y + (if (trunk) 90f else 0f)
        }

        val boxes = LinkedHashMap<String, Box>()
        for (n in r.nodes) {
            val (cx, top) = pos[n.id] ?: continue
            val (ex, ey) = nudges[n.id] ?: (0f to 0f)
            val ch = n.chapter?.takeIf { it.isNotBlank() }
            val laneNudge = ch?.let { r.story.laneNudges[it] }
            val (lx, ly) = ch?.let { nudges["chapter:$it"] } ?: (0f to 0f)
            val dx = n.nudgeX + ex + (laneNudge?.getOrNull(0) ?: 0f) + lx
            val dy = n.nudgeY + ey + (laneNudge?.getOrNull(1) ?: 0f) + ly
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
        val chapters = r.nodes.mapNotNull { n -> n.chapter?.takeIf { it.isNotBlank() }?.let { it to boxes[n.id] } }
            .filter { it.second != null }.groupBy({ it.first }, { it.second!! })
            .map { (name, bs) -> Chapter(name, bs.minOf { it.x } - 30f, bs.minOf { it.y } - 50f, bs.maxOf { it.x + W } + 30f, bs.maxOf { it.bottom } + 70f) }
        return Layout(boxes, ports, edges, back, loose.toSet(), maxX - minX, maxY + 80f, minX, chapters)
    }

    /** Is this door a loop back up the story? (For the "↺" mark in its row.) */
    fun isLoop(l: Layout, r: StoryRows, c: ChoiceRow): Boolean = l.edges.any { it.choiceId == c.id && it is Edge.Loop }
}
