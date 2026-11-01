package com.jackie.dungeon.car

import com.jackie.dungeon.call.TerminalLayout
import com.jackie.dungeon.engine.Expression
import com.jackie.dungeon.story.ChoiceRow
import com.jackie.dungeon.story.Dialogue
import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** The phosphor's colours; the renderer owns the actual RGB. */
enum class Ink { BG, PANEL, RULE, DIM, FG, BRIGHT, AMBER, RED, CYAN, INVERSE }

sealed interface Op {
    data class Fill(val x: Float, val y: Float, val w: Float, val h: Float, val ink: Ink) : Op
    /** One line of text, top-left at (x, y), one character cell per char. */
    data class Text(val x: Float, val y: Float, val text: String, val ink: Ink) : Op
}

data class Hit(val x0: Float, val y0: Float, val x1: Float, val y1: Float, val action: Action) {
    fun contains(x: Float, y: Float) = x in x0..x1 && y in y0..y1
}

enum class Scroll { MAP, SCRIPT, TILES }

data class ScrollArea(val x0: Float, val y0: Float, val x1: Float, val y1: Float, val kind: Scroll)

/** Everything one frame of the car editor draws, and what each part of it does when tapped. */
class Frame(val ops: List<Op>, val hits: List<Hit>, val scrolls: List<ScrollArea>) {
    /** The topmost thing at (x, y): later hits are drawn over earlier ones. */
    fun hit(x: Float, y: Float): Action? = hits.lastOrNull { it.contains(x, y) }?.action
    fun scrollAt(x: Float, y: Float): Scroll? = scrolls.lastOrNull { x in it.x0..it.x1 && y in it.y0..it.y1 }?.kind
    fun texts(): List<String> = ops.filterIsInstance<Op.Text>().map { it.text }
}

/** Facts about the story the map needs every frame, worked out once per edit. */
class MapInfo(
    val marks: Map<String, List<Highlight>>,
    val recorded: Set<String>,
    val scriptStart: Map<String, String>,
    val doors: Map<String, List<ChoiceRow>>,
    val fromOf: Map<String, String>,
) {
    companion object {
        fun of(r: StoryRows, highlights: Set<Highlight>) = MapInfo(
            marks = CarSurvey.marks(r, highlights),
            recorded = r.nodes.filter { n -> Dialogue.playbackFor(r, n).let { p -> p.isNotEmpty() && p.all { !it.audio.isNullOrEmpty() } } }.map { it.id }.toSet(),
            scriptStart = r.nodes.associate { n -> n.id to Dialogue.split(n.narration).joinToString(" ") { s -> (s.speaker?.let { "$it: " } ?: "") + s.text } },
            doors = r.nodes.associate { it.id to FlowLayout.doorsOf(r, it.id) },
            fromOf = r.choices.associate { it.id to it.fromNodeId },
        )
    }
}

/**
 * Draws a [CarState] as rectangles and text in the car screen's own pixels —
 * the same small offscreen the terminal is typed into, so the CRT pass bends
 * both alike. Pure: the renderer turns [Op]s into quads, the touch handler
 * asks the [Frame] what was tapped.
 */
object CarView {
    private const val MENU_ROW = 1.35f

    fun marginTop(v: Viewport) = v.ch * 0.6f
    fun marginSide(v: Viewport) = v.cw * 1.5f
    fun buttonH(v: Viewport) = v.ch * 1.3f
    /** The toolbar's bottom edge when it fits on one row. */
    fun toolbarBottom(v: Viewport) = marginTop(v) + buttonH(v) + v.ch * 0.35f

    fun render(r: StoryRows, layout: FlowLayout.Layout, s: CarState, v: Viewport, info: MapInfo, canUndo: Boolean): Frame {
        val b = Builder(v)
        val scene = s.scene?.takeIf { id -> r.nodes.any { it.id == id } }
        val buttons = if (scene == null) mapPage(b, r, layout, s, v, info, canUndo) else scenePage(b, r, s, scene, v, canUndo)
        if (s.menu.isNotEmpty()) menu(b, r, s, v, buttons, scene)
        s.popup?.let { popup(b, r, s, v, it) }
        return b.build()
    }

    /** The terminal's own overlay: a corner tab back to EDIT. */
    fun playOverlay(v: Viewport): Frame {
        val b = Builder(v)
        val label = " EDIT "
        val w = label.length * v.cw
        val x = v.w - marginSide(v) - w
        val y = marginTop(v) * 0.5f
        b.fill(x, y, w, v.ch, Ink.FG)
        b.text(x, y, label, Ink.INVERSE)
        b.hit(x - v.cw, 0f, v.w, y + v.ch * 1.6f, Action.ToEdit)
        return b.build()
    }

    // ---- the map ---------------------------------------------------------------------------

    private fun mapPage(b: Builder, r: StoryRows, layout: FlowLayout.Layout, s: CarState, v: Viewport, info: MapInfo, canUndo: Boolean): Map<String, Float> {
        val cam = CarEditor.camera(s, layout, r, v)
        val z = cam.zoom
        fun sx(x: Float) = (x - cam.cx) * z + v.w / 2
        fun sy(y: Float) = (y - cam.cy) * z + v.h / 2
        b.scroll(0f, 0f, v.w, v.h, Scroll.MAP)
        val inView = { x0: Float, y0: Float, x1: Float, y1: Float -> x1 >= 0 && x0 <= v.w && y1 >= 0 && y0 <= v.h }

        for (c in layout.chapters) {
            val x0 = sx(c.x0); val y0 = sy(c.y0); val x1 = sx(c.x1); val y1 = sy(c.y1)
            if (!inView(x0, y0, x1, y1)) continue
            b.outline(x0, y0, x1 - x0, y1 - y0, Ink.RULE)
            b.text(x0 + v.cw * 0.5f, y0 + 2f, fit(c.name.uppercase(), ((x1 - x0) / v.cw - 1).toInt()), Ink.DIM)
        }

        val boxH = CarEditor.BOX_H * z
        fun bottomOf(choiceId: String) = info.fromOf[choiceId]?.let { layout.boxes[it] }?.let { sy(it.y) + boxH }
        fun route(x0: Float, y0: Float, to: String?, ink: Ink) {
            val t = to?.let { layout.boxes[it] } ?: return
            val tx = sx(t.cx); val ty = sy(t.y)
            val mid = max(y0 + 6f, ty - 30f * z)
            if (!inView(min(x0, tx), y0, max(x0, tx), ty)) return
            b.vline(x0, y0, mid, ink); b.hline(min(x0, tx), max(x0, tx), mid, ink); b.vline(tx, mid, ty, ink)
            b.fill(tx - 1.5f, ty - 3f, 3f, 3f, ink)
        }
        for (e in layout.edges) {
            val px = sx(e.from.first)
            val py = bottomOf(e.choiceId) ?: continue
            when (e) {
                is FlowLayout.Edge.Forward -> route(px, py, e.to, if (e.fail) Ink.AMBER else Ink.DIM)
                is FlowLayout.Edge.Loop -> {
                    b.vline(px, py, py + 14f * z + 4f, Ink.DIM)
                    val name = r.nodes.firstOrNull { it.id == e.to }?.let { it.title.ifBlank { it.slug } } ?: ""
                    val cols = ((FlowLayout.W * z) / 3 / v.cw).toInt()
                    if (cols >= 2 && inView(px, py, px + v.cw * cols, py + v.ch * 2)) {
                        val t = fit("↺ " + name.uppercase(), cols)
                        b.text(px - v.cw / 2, py + 14f * z + 5f, t, Ink.CYAN)
                        b.hit(px - v.cw / 2, py + 14f * z + 5f, px + t.length * v.cw, py + 14f * z + 5f + v.ch, Action.OpenScene(e.to))
                    }
                }
                is FlowLayout.Edge.Nowhere -> {
                    b.vline(px, py, py + 10f * z + 3f, Ink.RED)
                    if (z * FlowLayout.W > v.cw * 8) b.text(px - v.cw / 2, py + 10f * z + 4f, "?", Ink.RED)
                }
                is FlowLayout.Edge.Fork -> {
                    val dy = py + 22f * z + 4f
                    b.vline(px, py, dy, Ink.AMBER)
                    val d = max(4f, min(v.cw, 18f * z))
                    b.fill(px - d / 2, dy, d, d, Ink.AMBER)
                    route(px, dy + d, e.yes, Ink.DIM)
                    route(px, dy + d, e.no, Ink.AMBER)
                }
            }
        }

        val root = r.story.rootNodeId
        for (n in r.nodes) {
            val box = layout.boxes[n.id] ?: continue
            val x = sx(box.x); val y = sy(box.y); val w = FlowLayout.W * z; val h = boxH
            if (!inView(x - 8, y - 8, x + w + 8, y + h + 8)) continue
            info.marks[n.id]?.forEachIndexed { i, m ->
                val g = 2f + i * 2.5f
                b.outline(x - g, y - g, w + 2 * g, h + 2 * g, HIGHLIGHT_INK.getValue(m))
            }
            b.fill(x, y, w, h, Ink.PANEL)
            val sel = n.id == s.selected
            b.outline(x, y, w, h, when { sel -> Ink.BRIGHT; n.id in layout.unreachable -> Ink.RULE; else -> Ink.DIM })
            if (sel) b.outline(x + 1, y + 1, w - 2, h - 2, Ink.BRIGHT)
            b.hit(x, y, x + w, y + h, Action.OpenScene(n.id))

            val cols = floor((w - v.cw * 0.8f) / v.cw).toInt()
            if (cols >= 4 && h >= v.ch * 1.1f) {
                val mark = when { n.nodeType == "ending" && n.endingKind == "win" -> "◎ "; n.nodeType == "ending" -> "✕ "; n.id == root -> "▶ "; else -> "" }
                val rec = if (n.id in info.recorded) " ♪" else ""
                val title = fit(mark + n.title.ifBlank { n.slug }.uppercase(), cols - rec.length) + rec
                b.text(x + v.cw * 0.4f, y + v.ch * 0.15f, title, if (n.nodeType == "ending" && n.endingKind != "win") Ink.RED else Ink.BRIGHT)
                val lines = floor((h - v.ch * 1.3f) / v.ch).toInt()
                val script = info.scriptStart[n.id].orEmpty()
                if (lines > 0) {
                    val wrapped = if (script.isBlank()) listOf("(no script yet)") else TerminalLayout.wrap("“$script”", cols)
                    wrapped.take(lines).forEachIndexed { i, l ->
                        val last = i == lines - 1 && wrapped.size > lines
                        b.text(x + v.cw * 0.4f, y + v.ch * (1.2f + i), if (last) fit(l, cols - 1) + "…" else l, if (script.isBlank()) Ink.RULE else Ink.DIM)
                    }
                }
            }
            // The keys along the bottom edge, and their words when there's room.
            val doors = if (n.nodeType == "ending") emptyList() else info.doors[n.id].orEmpty()
            if (doors.isNotEmpty() && w / (doors.size + 1) >= v.cw * 1.5f) {
                doors.forEachIndexed { i, c ->
                    val px = x + w * (i + 1) / (doors.size + 1)
                    val room = ((w / (doors.size + 1)) / v.cw - 1).toInt()
                    val words = if (room >= 5 && c.label.isNotBlank()) " " + c.label.uppercase() else ""
                    b.text(px + 3f, y + h + 2f, fit(c.digit + words, room.coerceAtLeast(1)), Ink.FG)
                }
            }
        }

        if (s.highlights.isNotEmpty()) {
            var lx = marginSide(v)
            val ly = v.h - v.ch * 1.6f
            b.fill(0f, ly - 3f, v.w, v.ch + 6f, Ink.BG)
            for (h in Highlight.entries) {
                if (h !in s.highlights) continue
                val n = info.marks.count { h in it.value }
                b.fill(lx, ly + v.ch * 0.25f, v.cw * 0.8f, v.ch * 0.5f, HIGHLIGHT_INK.getValue(h))
                val t = "${h.label} $n"
                b.text(lx + v.cw * 1.2f, ly, t, HIGHLIGHT_INK.getValue(h))
                lx += (t.length + 3) * v.cw
            }
        }

        return toolbar(b, v, buildList {
            add(Button("PLAY MODE", Action.ToPlay, short = "PLAY"))
            add(Button("VIEW ▾", Action.Menu(listOf("VIEW")), menu = "VIEW", on = s.menu.firstOrNull() == "VIEW", short = "VIEW▾"))
            add(Button("SCENE ▾", Action.Menu(listOf("SCENE")), menu = "SCENE", on = s.menu.firstOrNull() == "SCENE", enabled = s.selected != null, short = "SCENE▾"))
            add(Button("UNDO", Action.Undo, enabled = canUndo))
        }, title = r.story.title.ifBlank { "Untitled story" }.uppercase())
    }

    // ---- a scene, full screen ---------------------------------------------------------------

    private fun scenePage(b: Builder, r: StoryRows, s: CarState, id: String, v: Viewport, canUndo: Boolean): Map<String, Float> {
        val n = r.nodes.first { it.id == id }
        val left = marginSide(v); val right = v.w - marginSide(v)
        val cols = floor((right - left) / v.cw).toInt()
        val buttons = toolbar(b, v, listOf(
            Button("PLAY MODE", Action.ToPlay, short = "PLAY"),
            Button("‹ BACK", Action.Back, short = "‹"),
            Button("MAP", Action.ToMap),
            Button("SCENE ▾", Action.Menu(listOf("SCENE")), menu = "SCENE", on = s.menu.firstOrNull() == "SCENE", short = "SCENE▾"),
            Button("CHOICE ▾", Action.Menu(listOf("CHOICE")), menu = "CHOICE", on = s.menu.firstOrNull() == "CHOICE", short = "CHOICE▾"),
            Button("ITEMS ▾", Action.Menu(listOf("ITEMS")), menu = "ITEMS", on = s.menu.firstOrNull() == "ITEMS", short = "ITEMS▾"),
            Button("+ CHOICE", Action.AddChoice(id), enabled = n.nodeType != "ending", short = "+"),
            Button("▶ PLAY HERE", Action.PlayHere(id), short = "▶HERE"),
            Button("UNDO", Action.Undo, enabled = canUndo),
        ))
        var y = b.toolbarBottom + v.ch * 0.3f

        // The name, and what kind of scene it is.
        val parts = Dialogue.playbackFor(r, n)
        val byLine = parts.size > 1 || Dialogue.splitsByLine(r, nodeId = id)
        val tag = buildList {
            if (id == r.story.rootNodeId) add("START")
            if (n.nodeType == "ending") add(if (n.endingKind == "win") "ENDING: WIN" else "ENDING: DEATH")
            n.chapter?.takeIf { it.isNotBlank() }?.let { add(it.uppercase()) }
        }.joinToString(" · ")
        val take = n.audioPath?.takeIf { !byLine && it.isNotEmpty() }
        val takeLabel = if (take != null) "  ♪ ▶ PLAY" else ""
        val titleRoom = cols - tag.length - takeLabel.length - 2
        b.text(left, y, fit(n.title.ifBlank { n.slug }.uppercase(), titleRoom.coerceAtLeast(6)), Ink.BRIGHT)
        if (tag.isNotEmpty()) b.text(right - (tag.length + takeLabel.length) * v.cw, y, tag, Ink.DIM)
        if (take != null) {
            val tx = right - takeLabel.length * v.cw
            b.text(tx, y, takeLabel, Ink.CYAN)
            b.hit(tx, y - 4f, right, y + v.ch + 4f, Action.PlayTake(take))
        }
        y += v.ch * 1.3f

        // Choice tiles along the bottom; the line of facts above them.
        val doors = if (n.nodeType == "ending") emptyList() else FlowLayout.doorsOf(r, id)
        // Three lines a tile when there's room; at the big text sizes, two (key and
        // destination), so the script keeps at least a few rows.
        val tileLines = if (v.h - y - marginTop(v) - v.ch * 1.7f - v.ch * 3.5f >= v.ch * 3) 3 else 2
        val tileH = v.ch * tileLines + v.ch * 0.5f
        val tilesTop = v.h - marginTop(v) - tileH
        // The facts line sits above the tiles — unless that would leave the script
        // fewer than three rows (large text), when the facts scroll with the script.
        val factsLine = (tilesTop - v.ch * 1.7f - y) / v.ch >= 3
        val factsY = if (factsLine) tilesTop - v.ch * 1.4f else tilesTop
        val gives = r.effects.filter { it.nodeId == id && it.operation == "grant" }.mapNotNull { e -> r.stateVars.firstOrNull { it.id == e.stateVarId }?.name?.uppercase() }
        val silent = CarSurvey.silentParts(r, id)
        val givesText = if (gives.isEmpty()) null else "GIVES: ${gives.joinToString(", ")}"
        val recText = if (silent.isEmpty()) "ALL RECORDED ♪" else "SILENT: " + silent.joinToString(", ")

        // The script, scrolled.
        val scriptBottom = factsY - v.ch * 0.3f
        val rowsAvail = floor((scriptBottom - y) / v.ch).toInt().coerceAtLeast(1)
        data class Row(val text: String, val ink: Ink, val take: String?)
        val textCols = cols - 8
        val script = ArrayList<Row>()
        if (!factsLine) {
            givesText?.let { script += Row(it, Ink.FG, null) }
            TerminalLayout.wrap(recText, textCols, 2).forEach { script += Row(it, if (silent.isEmpty()) Ink.CYAN else Ink.AMBER, null) }
        }
        val speakers = r.characters.map { it.name }
        val inkFor = { who: String? -> if (who == null) Ink.FG else listOf(Ink.CYAN, Ink.AMBER, Ink.BRIGHT)[speakers.indexOf(who).coerceAtLeast(0) % 3] }
        if (byLine) {
            for (p in parts) {
                val text = (p.speaker?.let { "${it.uppercase()}: " } ?: "") + p.say
                val wrapped = TerminalLayout.wrap(text, textCols, 2)
                wrapped.forEachIndexed { i, l -> script += Row(l, if (p.audio.isNullOrEmpty()) Ink.DIM else inkFor(p.speaker), if (i == 0) p.audio ?: "" else null) }
            }
        } else {
            for (sp in Dialogue.split(n.narration)) {
                TerminalLayout.wrap((sp.speaker?.let { "${it.uppercase()}: " } ?: "") + sp.text, textCols, 2).forEach { script += Row(it, inkFor(sp.speaker), null) }
            }
        }
        if (script.none { it.take != null || it.ink != Ink.AMBER && it.ink != Ink.CYAN && !it.text.startsWith("GIVES") } && Dialogue.split(n.narration).isEmpty()) script += Row("(No script yet. SCENE ▾ → EDIT SCRIPT, then type it on your phone.)", Ink.RULE, null)
        val maxScroll = (script.size - rowsAvail).coerceAtLeast(0)
        val first = s.scriptScroll.coerceIn(0, maxScroll)
        b.scroll(left, y, right, scriptBottom, Scroll.SCRIPT)
        script.drop(first).take(rowsAvail).forEachIndexed { i, row ->
            val ry = y + i * v.ch
            b.text(left, ry, row.text, row.ink)
            when {
                row.take == null -> Unit
                row.take.isEmpty() -> b.text(right - 7 * v.cw, ry, "silent", Ink.RULE)
                else -> { b.text(right - 4 * v.cw, ry, "♪ ▶", Ink.CYAN); b.hit(right - 5 * v.cw, ry - 2f, right, ry + v.ch + 2f, Action.PlayTake(row.take)) }
            }
        }
        if (maxScroll > 0) {
            val trackH = rowsAvail * v.ch
            val barH = max(v.ch, trackH * rowsAvail / script.size)
            val barY = y + (trackH - barH) * first / maxScroll
            b.fill(right + v.cw * 0.6f, y, 2f, trackH, Ink.RULE)
            b.fill(right + v.cw * 0.6f - 1f, barY, 4f, barH, Ink.FG)
            if (first > 0) { b.text(right - v.cw, y, "▲", Ink.FG); b.hit(right - 2 * v.cw, y, right + v.cw * 1.4f, y + v.ch, Action.ScrollScript(-max(1, rowsAvail - 1))) }
            if (first < maxScroll) { val ay = y + (rowsAvail - 1) * v.ch; b.text(right - v.cw, ay, "▼", Ink.FG); b.hit(right - 2 * v.cw, ay, right + v.cw * 1.4f, ay + v.ch, Action.ScrollScript(max(1, rowsAvail - 1))) }
        }

        // What the scene gives on arrival, and what is still silent.
        if (factsLine) {
            var fx = left
            givesText?.let { b.text(fx, factsY, it, Ink.FG); fx += (it.length + 3) * v.cw }
            b.text(fx, factsY, fit(recText, ((right - fx) / v.cw).toInt()), if (silent.isEmpty()) Ink.CYAN else Ink.AMBER)
        }

        // The tiles, scrolled sideways.
        b.hline(left, right, tilesTop - v.ch * 0.25f, Ink.RULE)
        if (n.nodeType == "ending") {
            b.text(left, tilesTop + v.ch, "The call ends here. SCENE ▾ → ENDING to change that.", Ink.DIM)
            return buttons
        }
        if (doors.isEmpty()) {
            b.text(left, tilesTop + v.ch, "No choices yet: the call would drop. Tap + CHOICE.", Ink.RED)
            return buttons
        }
        val arrow = v.cw * 2f
        val gap = v.cw
        val area = right - left - 2 * arrow
        val tileW = max(v.cw * 16f, (area - 2 * gap) / 3f)
        val visible = max(1, floor((area + gap) / (tileW + gap)).toInt())
        val maxTile = (doors.size - visible).coerceAtLeast(0)
        val firstTile = s.tileScroll.coerceIn(0, maxTile)
        b.scroll(left, tilesTop, right, tilesTop + tileH, Scroll.TILES)
        val tcols = floor((tileW - v.cw) / v.cw).toInt()
        doors.drop(firstTile).take(visible).forEachIndexed { i, c ->
            val tx = left + arrow + i * (tileW + gap)
            val sel = c.id == s.choice
            b.fill(tx, tilesTop, tileW, tileH, Ink.PANEL)
            b.outline(tx, tilesTop, tileW, tileH, if (sel) Ink.BRIGHT else Ink.DIM)
            if (sel) b.outline(tx + 1, tilesTop + 1, tileW - 2, tileH - 2, Ink.BRIGHT)
            val ix = tx + v.cw * 0.5f
            val l1 = tilesTop + v.ch * 0.25f
            b.text(ix, l1, c.digit, Ink.BRIGHT)
            b.text(ix + 2 * v.cw, l1, fit(c.label.ifBlank { "(no words yet)" }.uppercase(), tcols - 2), if (c.label.isBlank()) Ink.RULE else Ink.FG)
            b.hit(tx, tilesTop, tx + tileW, l1 + v.ch, Action.SelectChoice(c.id))
            val gate = r.gates.firstOrNull { it.choiceId == c.id }
            val give = StoryEditor.gives(r, c.id)
            if (tileLines < 3 && (gate != null || give != null)) {
                // No room for the items line: a marker in the corner opens the details.
                val mx = tx + tileW - v.cw * 1.6f
                b.fill(mx - 2f, l1, v.cw * 1.4f, v.ch, Ink.PANEL)
                b.text(mx, l1, if (gate != null) "◆" else "+", Ink.AMBER)
                b.hit(mx - v.cw, tilesTop, tx + tileW, l1 + v.ch, Action.ItemInfo(c.id))
            }
            val l2 = l1 + v.ch
            val dest = c.toNodeId?.let { t -> r.nodes.firstOrNull { it.id == t } }
            if (dest == null) {
                b.text(ix, l2, fit("» NOWHERE YET", tcols), Ink.RED)
                b.hit(tx, l2, tx + tileW, l2 + v.ch, Action.SelectChoice(c.id))
            } else {
                b.text(ix, l2, fit("» " + dest.title.ifBlank { dest.slug }.uppercase(), tcols), Ink.CYAN)
                b.hit(tx, l2, tx + tileW, l2 + v.ch, Action.OpenScene(dest.id))
            }
            val l3 = l2 + v.ch
            if (tileLines < 3) return@forEachIndexed
            val bits = ArrayList<Pair<String, Ink>>()
            if (gate != null) bits += ("◆" + itemWords(r, gate.expression).uppercase() + if (gate.failBehavior == "divert") " ELSE →" else "") to Ink.AMBER
            if (give != null) bits += ("+" + give.name.ifBlank { give.slug }.uppercase()) to Ink.FG
            val reply = Dialogue.reactionPlaybackFor(r, c)
            if (reply.isNotEmpty()) bits += (if (reply.all { !it.audio.isNullOrEmpty() }) "“♪" else "“") to Ink.DIM
            var bx = ix
            for ((t, ink) in bits) {
                val room = ((tx + tileW - bx) / v.cw).toInt() - 1
                if (room < 2) break
                val shown = fit(t, room)
                b.text(bx, l3, shown, ink); bx += (shown.length + 1) * v.cw
            }
            b.hit(tx, l3, tx + tileW, tilesTop + tileH, if (gate != null || give != null) Action.ItemInfo(c.id) else Action.SelectChoice(c.id))
        }
        if (firstTile > 0) {
            b.text(left + v.cw * 0.4f, tilesTop + tileH / 2 - v.ch / 2, "◀", Ink.BRIGHT)
            b.hit(0f, tilesTop, left + arrow, tilesTop + tileH, Action.ScrollTiles(-1))
        }
        if (firstTile < maxTile) {
            b.text(right - v.cw * 1.4f, tilesTop + tileH / 2 - v.ch / 2, "▶", Ink.BRIGHT)
            b.hit(right - arrow, tilesTop, v.w, tilesTop + tileH, Action.ScrollTiles(1))
        }
        return buttons
    }

    // ---- toolbar and menus ------------------------------------------------------------------

    private data class Button(val full: String, val action: Action, val menu: String? = null, val on: Boolean = false, val enabled: Boolean = true, val short: String = full) {
        var label = full
    }

    /** Lays the buttons out left to right, wrapping when the screen is narrow (large text). Returns where each menu's button sits. */
    private fun toolbar(b: Builder, v: Viewport, buttons: List<Button>, title: String? = null): Map<String, Float> {
        val left = marginSide(v); val right = v.w - marginSide(v)
        val bh = buttonH(v); val gap = v.cw * 0.6f
        // Large text: if the full labels need more than two rows, use the short ones.
        val fullWidth = buttons.sumOf { ((it.full.length + 2) * v.cw + gap).toDouble() }
        buttons.forEach { it.label = if (fullWidth > 2 * (right - left) - 4 * v.cw) it.short else it.full }
        var x = left; var y = marginTop(v)
        val placed = ArrayList<Triple<Button, Float, Float>>()
        for (btn in buttons) {
            val w = (btn.label.length + 2) * v.cw
            if (x + w > right && x > left) { x = left; y += bh + v.ch * 0.25f }
            placed += Triple(btn, x, y)
            x += w + gap
        }
        val bottom = y + bh + v.ch * 0.35f
        b.toolbarBottom = bottom
        b.fill(0f, 0f, v.w, bottom, Ink.BG)
        b.hline(0f, v.w, bottom - 1f, Ink.RULE)
        val at = HashMap<String, Float>()
        for ((btn, bx, by) in placed) {
            val w = (btn.label.length + 2) * v.cw
            val ty = by + (bh - v.ch) / 2
            if (btn.on) b.fill(bx, by, w, bh, Ink.FG)
            b.outline(bx, by, w, bh, if (btn.enabled) Ink.DIM else Ink.RULE)
            b.text(bx + v.cw, ty, btn.label, when { btn.on -> Ink.INVERSE; !btn.enabled -> Ink.RULE; else -> Ink.FG })
            if (btn.enabled) b.hit(bx, by, bx + w, by + bh, btn.action)
            btn.menu?.let { at[it] = bx; at["$it.y"] = by + bh }
        }
        if (title != null && placed.isNotEmpty()) {
            val (lb, lx, ly) = placed.last()
            val from = lx + (lb.label.length + 2) * v.cw + v.cw * 2
            val room = ((right - from) / v.cw).toInt()
            if (room >= 8) b.text(right - min(room, title.length) * v.cw, ly + (bh - v.ch) / 2, fit(title, room), Ink.DIM)
        }
        return at
    }

    data class Entry(val label: String, val action: Action?, val enabled: Boolean = true, val on: Boolean = false)

    /** What a menu holds. [path] is its name and any submenus opened inside it. */
    fun entries(path: List<String>, s: CarState, r: StoryRows): List<Entry> {
        val sub = { key: String -> Action.Menu(path + key) }
        val out = ArrayList<Entry>()
        if (path.size > 1) out += Entry("‹ BACK", Action.Menu(path.dropLast(1)))
        val sceneId = s.scene ?: s.selected
        val n = r.nodes.firstOrNull { it.id == sceneId }
        val c = r.choices.firstOrNull { it.id == s.choice && it.fromNodeId == s.scene }
        when (path.first()) {
            "VIEW" -> when (path.getOrNull(1)) {
                null -> {
                    out += Entry("FIT WHOLE STORY", Action.Fit)
                    out += Entry("GO TO START", Action.GoStart)
                    out += Entry("ZOOM IN", Action.ZoomBy(1.5f))
                    out += Entry("ZOOM OUT", Action.ZoomBy(1 / 1.5f))
                    if (StoryEditor.chapters(r).isNotEmpty()) out += Entry("CHAPTER ▸", sub("CHAPTER"))
                    out += Entry("HIGHLIGHTS: ON YOUR PHONE", null, enabled = false)
                }
                "CHAPTER" -> StoryEditor.chapters(r).forEach { out += Entry(it.uppercase(), Action.GoChapter(it)) }
            }
            "SCENE" -> {
                if (n == null) return out + Entry("TAP A SCENE FIRST", null, enabled = false)
                when (path.getOrNull(1)) {
                    null -> {
                        if (s.scene == null) out += Entry("OPEN THIS SCENE", Action.OpenScene(n.id))
                        out += Entry("RENAME…", Action.EditOnPhone(Focus.Scene(n.id), "RENAME"))
                        out += Entry("EDIT SCRIPT…", Action.EditOnPhone(Focus.Scene(n.id), "SCRIPT"))
                        out += Entry("ENDING ▸", sub("ENDING"))
                        n.audioPath?.takeIf { it.isNotEmpty() }?.let { out += Entry("♪ PLAY ITS TAKE", Action.PlayTake(it)) }
                        out += Entry("▶ PLAY FROM HERE", Action.PlayHere(n.id))
                        if (n.nodeType != "ending") out += Entry("+ ADD CHOICE", Action.AddChoice(n.id), enabled = StoryEditor.freeKey(r, n.id) != null)
                        if (n.id != r.story.rootNodeId) {
                            out += Entry("MAKE THIS THE START", Action.MakeStart(n.id))
                            out += Entry("DELETE SCENE ▸", sub("DELETE"))
                        }
                    }
                    "ENDING" -> {
                        val kind = if (n.nodeType == "ending") n.endingKind ?: "death" else "room"
                        for ((k, t) in listOf("room" to "NOT AN ENDING", "death" to "ENDS: DEATH", "win" to "ENDS: WIN")) out += Entry(t, Action.SetEnding(n.id, k), on = kind == k)
                    }
                    "DELETE" -> {
                        // What led into it can lead on to where it went: one way on joins up
                        // by itself; with several, the author picks which.
                        val on = StoryEditor.onward(r, n.id)
                        val inCount = StoryEditor.into(r, n.id).size
                        when {
                            inCount == 0 || on.isEmpty() -> out += Entry("YES, DELETE “${fit(n.title.ifBlank { n.slug }.uppercase(), 20)}”", Action.DeleteScene(n.id))
                            else -> {
                                on.forEach { t -> out += Entry("DELETE, JOIN TO ${fit(sceneName(r, t).uppercase(), 20)}", Action.DeleteScene(n.id, t)) }
                                if (on.size > 1) out += Entry("DELETE, LEAVE UNJOINED", Action.DeleteScene(n.id))
                            }
                        }
                    }
                }
            }
            "CHOICE" -> {
                if (c == null) {
                    out += Entry("TAP A CHOICE TILE FIRST", null, enabled = false)
                    n?.takeIf { it.nodeType != "ending" }?.let { out += Entry("+ ADD CHOICE", Action.AddChoice(it.id)) }
                    return out
                }
                when (path.getOrNull(1)) {
                    null -> {
                        out += Entry("RENAME CHOICE…", Action.EditOnPhone(Focus.Choice(c.id), "CHOICE NAME"))
                        out += Entry("EDIT REPLY…", Action.EditOnPhone(Focus.Choice(c.id), "REPLY"))
                        Dialogue.reactionPlaybackFor(r, c).firstOrNull { !it.audio.isNullOrEmpty() }?.audio?.let { out += Entry("♪ PLAY REPLY", Action.PlayTake(it)) }
                        out += Entry("KEY: ${c.digit} ▸", sub("KEY"))
                        out += Entry("LEADS TO ▸", sub("LEADS"))
                        c.toNodeId?.let { t -> out += Entry("GO TO ${fit(sceneName(r, t), 18)}", Action.OpenScene(t)) }
                        out += Entry("DELETE CHOICE ▸", sub("DELETE"))
                    }
                    "KEY" -> {
                        val taken = r.choices.filter { it.fromNodeId == c.fromNodeId && it.id != c.id }.map { it.digit }.toSet()
                        StoryEditor.KEYS.forEach { k -> out += Entry("PRESS $k", Action.SetKey(c.id, k), enabled = k !in taken, on = k == c.digit) }
                    }
                    "LEADS" -> {
                        out += Entry("A NEW SCENE", Action.WireNew(c.id))
                        out += Entry("NOWHERE YET", Action.Unwire(c.id), on = c.toNodeId == null)
                        out += Entry("ANOTHER SCENE… (PICK ON PHONE)", Action.EditOnPhone(Focus.Choice(c.id), "LEADS TO"))
                    }
                    "DELETE" -> out += Entry("YES, DELETE CHOICE ${c.digit}", Action.DeleteChoice(c.id))
                }
            }
            "ITEMS" -> {
                if (c == null) return out + Entry("TAP A CHOICE TILE FIRST", null, enabled = false)
                val gate = r.gates.firstOrNull { it.choiceId == c.id }
                val need = StoryEditor.need(r, c.id)
                val items = r.stateVars.filter { it.kind != "counter" }
                when (path.getOrNull(1)) {
                    null -> {
                        out += Entry("GIVES: ${StoryEditor.gives(r, c.id)?.name?.uppercase() ?: "NOTHING"} ▸", sub("GIVES"))
                        if (gate != null && need == null) out += Entry("NEEDS: ${fit(StoryEditor.describe(gate.expression).uppercase(), 20)} (PHONE)", Action.EditOnPhone(Focus.Choice(c.id), "REQUIRES"))
                        else out += Entry("NEEDS: ${fit((need?.let { StoryEditor.needWords(r, it) } ?: "nothing").uppercase(), 24)} ▸", sub("NEEDS"))
                        if (need != null) {
                            out += Entry("IF THEY DON'T HAVE IT ▸", sub("IFNOT"))
                            if (gate?.failBehavior == "refuse") {
                                out += Entry("REFUSAL WORDS…", Action.EditOnPhone(Focus.Choice(c.id), "REFUSAL"))
                                gate.failAudioPath?.takeIf { it.isNotEmpty() }?.let { out += Entry("♪ PLAY REFUSAL", Action.PlayTake(it)) }
                            }
                        }
                        if (gate != null || StoryEditor.gives(r, c.id) != null) out += Entry("DETAILS", Action.ItemInfo(c.id))
                    }
                    "GIVES" -> {
                        val now = StoryEditor.gives(r, c.id)?.id
                        out += Entry("NOTHING", Action.Gives(c.id, null), on = now == null)
                        items.forEach { out += Entry(it.name.ifBlank { it.slug }.uppercase(), Action.Gives(c.id, it.id), on = it.id == now) }
                        out += Entry("A NEW ITEM… (PHONE)", Action.EditOnPhone(Focus.Choice(c.id), "NEW ITEM"))
                    }
                    "NEEDS" -> {
                        // Ticks: several can be on. With two or more, ANY ONE or ALL.
                        out += Entry("NOTHING", Action.Requires(c.id, null), on = need == null)
                        items.forEach { out += Entry(it.name.ifBlank { it.slug }.uppercase(), Action.ToggleNeed(c.id, it.slug), on = need?.slugs?.contains(it.slug) == true) }
                        if (need != null && need.slugs.size > 1) {
                            out += Entry("ANY ONE OF THESE", Action.NeedAny(c.id, true), on = need.any)
                            out += Entry("ALL OF THESE", Action.NeedAny(c.id, false), on = !need.any)
                        }
                    }
                    "IFNOT" -> {
                        out += Entry("REFUSE: STAY HERE", Action.Refuse(c.id), on = gate?.failBehavior == "refuse")
                        out += Entry("GO TO A NEW SCENE", Action.ForkNew(c.id), on = gate?.failBehavior == "divert")
                        out += Entry("GO TO… (PICK ON PHONE)", Action.EditOnPhone(Focus.Choice(c.id), "FORK"))
                    }
                }
            }
        }
        return out
    }

    private fun menu(b: Builder, r: StoryRows, s: CarState, v: Viewport, buttons: Map<String, Float>, scene: String?) {
        val list = entries(s.menu, s.copy(scene = scene), r)
        if (list.isEmpty()) return
        // Tapping outside closes it.
        b.hit(0f, b.toolbarBottom, v.w, v.h, Action.Dismiss)
        val rowH = v.ch * MENU_ROW
        val top = buttons["${s.menu.first()}.y"]?.plus(2f) ?: b.toolbarBottom
        val perCol = max(1, floor((v.h - top - marginTop(v)) / rowH).toInt())
        val colsNeeded = (list.size + perCol - 1) / perCol
        val colW = (list.maxOf { it.label.length } + 4) * v.cw
        val total = colW * colsNeeded
        val x0 = (buttons[s.menu.first()] ?: marginSide(v)).coerceAtMost(v.w - marginSide(v) - total).coerceAtLeast(marginSide(v) * 0.5f)
        val shownRows = min(perCol, list.size)
        b.fill(x0 - 2f, top - 2f, total + 4f, shownRows * rowH + 4f, Ink.BG)
        b.outline(x0 - 2f, top - 2f, total + 4f, shownRows * rowH + 4f, Ink.FG)
        list.forEachIndexed { i, e ->
            val cx = x0 + (i / perCol) * colW
            val cy = top + (i % perCol) * rowH
            if (e.on) b.fill(cx, cy, colW, rowH, Ink.RULE)
            b.text(cx + v.cw * 0.6f, cy + (rowH - v.ch) / 2, (if (e.on) "■ " else "  ") + e.label, when { !e.enabled -> Ink.DIM; e.on -> Ink.BRIGHT; else -> Ink.FG })
            // A tap on a disabled entry keeps the menu open rather than falling through to the map.
            b.hit(cx, cy, cx + colW, cy + rowH, if (e.enabled && e.action != null) e.action else Action.None)
        }
    }

    // ---- popups ----------------------------------------------------------------------------

    private fun popup(b: Builder, r: StoryRows, s: CarState, v: Viewport, p: Popup) {
        val w = min(v.w - 4 * v.cw, 64 * v.cw)
        val cols = floor((w - 2 * v.cw) / v.cw).toInt()
        val lines = ArrayList<Pair<String, Ink>>()
        val buttons = ArrayList<Pair<String, Action>>()
        var grid: List<Triple<String, Ink, Action>> = emptyList()
        when (p) {
            is Popup.Notice -> { TerminalLayout.wrap(p.text, cols).forEach { lines += it to Ink.BRIGHT }; buttons += "OK" to Action.Dismiss }
            is Popup.ItemInfo -> {
                val c = r.choices.firstOrNull { it.id == p.choiceId } ?: return
                val gate = r.gates.firstOrNull { it.choiceId == c.id }
                lines += "PRESS ${c.digit} · ${c.label.ifBlank { "(no words yet)" }.uppercase()}" to Ink.BRIGHT
                lines += "" to Ink.DIM
                if (gate == null) lines += "NEEDS NOTHING" to Ink.DIM
                else {
                    lines += "NEEDS: ${itemWords(r, gate.expression).uppercase()}" to Ink.AMBER
                    if (gate.consumeOnPass) lines += "AND USES IT UP" to Ink.AMBER
                    if (gate.failBehavior == "divert") {
                        lines += "WITHOUT IT: GOES TO ${sceneName(r, gate.failNodeId).uppercase()}" to Ink.FG
                        gate.failNodeId?.let { buttons += "GO THERE" to Action.OpenScene(it) }
                    } else {
                        lines += "WITHOUT IT: REFUSED, STAYS HERE" to Ink.FG
                        gate.failNarration?.takeIf { it.isNotBlank() }?.let { f -> TerminalLayout.wrap("“$f”", cols, 1).forEach { lines += it to Ink.DIM } }
                        lines += (if (gate.failAudioPath.isNullOrEmpty()) "REFUSAL: SILENT" else "REFUSAL: RECORDED ♪") to if (gate.failAudioPath.isNullOrEmpty()) Ink.AMBER else Ink.CYAN
                    }
                }
                StoryEditor.gives(r, c.id)?.let { lines += "GIVES: ${it.name.ifBlank { it.slug }.uppercase()}" to Ink.FG }
                buttons += "EDIT ON PHONE" to Action.EditOnPhone(Focus.Choice(c.id), "ITEMS")
                buttons += "CLOSE" to Action.Dismiss
            }
            is Popup.PlayHere -> {
                lines += fit("PLAY FROM ${sceneName(r, p.nodeId).uppercase()}", cols) to Ink.BRIGHT
                lines += (if (r.stateVars.isEmpty()) "This story has no items." else "CARRYING (TAP TO CHANGE):") to Ink.DIM
                grid = r.stateVars.map { sv ->
                    val name = sv.name.ifBlank { sv.slug }.uppercase()
                    val n = p.carrying[sv.slug] ?: 0
                    if (sv.kind == "counter") Triple("$name: $n  +", if (n > 0) Ink.BRIGHT else Ink.FG, Action.Carry(sv.slug, if (n >= r.story.counterClamp) 0 else n + 1))
                    else Triple((if (n > 0) "■ " else "□ ") + name, if (n > 0) Ink.BRIGHT else Ink.FG, Action.Carry(sv.slug, if (n > 0) 0 else 1))
                }
                buttons += "CANCEL" to Action.Dismiss
                buttons += "START" to Action.StartCall
            }
        }
        val cellW = (grid.maxOfOrNull { it.first.length } ?: 0).plus(3) * v.cw
        val perRow = if (grid.isEmpty()) 1 else max(1, floor((w - 2 * v.cw) / cellW).toInt())
        val gridRows = (grid.size + perRow - 1) / perRow
        val rowH = v.ch * 1.3f
        val maxGridRows = max(1, floor((v.h - 4 * v.ch - (lines.size + 2) * v.ch) / rowH).toInt())
        val shownGrid = min(gridRows, maxGridRows)
        val h = (lines.size + 2.2f) * v.ch + shownGrid * rowH + buttonH(v)
        val x0 = (v.w - w) / 2
        val y0 = ((v.h - h) / 2).coerceAtLeast(marginTop(v))
        b.hit(0f, 0f, v.w, v.h, if (p is Popup.PlayHere) Action.None else Action.Dismiss)
        b.fill(x0, y0, w, h, Ink.BG)
        b.outline(x0, y0, w, h, Ink.FG)
        b.outline(x0 + 2, y0 + 2, w - 4, h - 4, Ink.RULE)
        var y = y0 + v.ch * 0.6f
        for ((t, ink) in lines) { b.text(x0 + v.cw, y, fit(t, cols), ink); y += v.ch }
        grid.take(shownGrid * perRow).forEachIndexed { i, (t, ink, a) ->
            val gx = x0 + v.cw + (i % perRow) * cellW
            val gy = y + (i / perRow) * rowH
            b.text(gx, gy + (rowH - v.ch) / 2, t, ink)
            b.hit(gx, gy, gx + cellW, gy + rowH, a)
        }
        if (gridRows > shownGrid) b.text(x0 + w - 6 * v.cw, y + shownGrid * rowH - v.ch, "+${grid.size - shownGrid * perRow}", Ink.DIM)
        y += shownGrid * rowH + v.ch * 0.6f
        var bx = x0 + w - v.cw
        for ((t, a) in buttons.reversed()) {
            val bw = (t.length + 2) * v.cw
            bx -= bw
            val primary = a == Action.StartCall
            if (primary) b.fill(bx, y, bw, buttonH(v), Ink.FG)
            b.outline(bx, y, bw, buttonH(v), Ink.FG)
            b.text(bx + v.cw, y + (buttonH(v) - v.ch) / 2, t, if (primary) Ink.INVERSE else Ink.FG)
            b.hit(bx, y, bx + bw, y + buttonH(v), a)
            bx -= v.cw
        }
    }

    // ---- helpers ---------------------------------------------------------------------------

    val HIGHLIGHT_INK = mapOf(Highlight.EMPTY to Ink.AMBER, Highlight.DEAD_END to Ink.RED, Highlight.UNRECORDED to Ink.CYAN)

    fun fit(t: String, cols: Int): String = when {
        cols <= 0 -> ""
        t.length <= cols -> t
        cols == 1 -> t.take(1)
        else -> t.take(cols - 1).trimEnd() + "…"
    }

    private fun sceneName(r: StoryRows, id: String?) = r.nodes.firstOrNull { it.id == id }?.let { it.title.ifBlank { it.slug } } ?: "nowhere yet"

    /** A condition in words, with item NAMES rather than slugs. */
    private fun itemWords(r: StoryRows, e: Expression): String {
        val names = r.stateVars.associate { it.slug to it.name.ifBlank { it.slug } }
        return when (e) {
            is Expression.Has -> names[e.v] ?: e.v
            is Expression.Lacks -> "no " + (names[e.v] ?: e.v)
            is Expression.And -> e.args.joinToString(" + ") { itemWords(r, it) }
            is Expression.Or -> e.args.joinToString(" or ") { itemWords(r, it) }
            else -> StoryEditor.describe(e)
        }
    }

    private class Builder(val v: Viewport) {
        val ops = ArrayList<Op>()
        val hits = ArrayList<Hit>()
        val scrolls = ArrayList<ScrollArea>()
        var toolbarBottom = toolbarBottom(v)
        fun fill(x: Float, y: Float, w: Float, h: Float, ink: Ink) { if (w > 0 && h > 0) ops += Op.Fill(x, y, w, h, ink) }
        fun text(x: Float, y: Float, t: String, ink: Ink) { if (t.isNotEmpty()) ops += Op.Text(x, y, t, ink) }
        fun hline(x0: Float, x1: Float, y: Float, ink: Ink) = fill(x0, y, max(1f, x1 - x0), 1f, ink)
        fun vline(x: Float, y0: Float, y1: Float, ink: Ink) = fill(x, min(y0, y1), 1f, max(1f, kotlin.math.abs(y1 - y0)), ink)
        fun outline(x: Float, y: Float, w: Float, h: Float, ink: Ink) {
            fill(x, y, w, 1f, ink); fill(x, y + h - 1f, w, 1f, ink)
            fill(x, y, 1f, h, ink); fill(x + w - 1f, y, 1f, h, ink)
        }
        fun hit(x0: Float, y0: Float, x1: Float, y1: Float, a: Action) { hits += Hit(x0, y0, x1, y1, a) }
        fun scroll(x0: Float, y0: Float, x1: Float, y1: Float, k: Scroll) { scrolls += ScrollArea(x0, y0, x1, y1, k) }
        fun build() = Frame(ops, hits, scrolls)
    }
}
