package com.jackie.dungeon.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp
import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.FlowLayout.Edge
import com.jackie.dungeon.story.StoryRows
import kotlin.math.hypot

/**
 * The story as a flowchart: scenes as boxes with their choices listed inside,
 * each choice leaving from a numbered circle on the bottom edge. Pinch to
 * zoom, drag to pan. Positions come from [FlowLayout]; nothing here decides
 * where anything goes.
 *
 * Taps: a box's header edits the scene; a choice row or its circle edits the
 * choice; the three buttons along the bottom edit, add a choice, or play from
 * that scene; a "↺" link jumps to the scene it loops back to.
 */
@Composable
fun Flowchart(
    rows: StoryRows,
    selected: String?,
    focus: (String) -> Unit,
    onScene: (String) -> Unit,
    onChoice: (String) -> Unit,
    onAddChoice: (String) -> Unit,
    onPlayFrom: (String) -> Unit,
    modifier: Modifier = Modifier,
    jumpTo: String? = null,
    /** Start at this zoom instead of a readable one (the whole-story view). */
    startScale: Float? = null,
    /** A box ("<scene id>") or a lane ("chapter:<name>") was dragged this far, in layout units. */
    onNudge: (String, Float, Float) -> Unit = { _, _, _ -> },
) {
    // What is being dragged right now, and by how much: drawn live, saved on release.
    var drag by remember { mutableStateOf<Pair<String, Offset>?>(null) }
    val layout = remember(rows, drag) { FlowLayout.layout(rows, drag?.let { (k, d) -> mapOf(k to (d.x to d.y)) } ?: emptyMap()) }
    val haptics = LocalHapticFeedback.current
    // The gesture handler outlives each layout (a drag changes it every move), so it reads the latest.
    val latest = androidx.compose.runtime.rememberUpdatedState(layout)
    val measurer = rememberTextMeasurer(cacheSize = 1024)
    val density = LocalDensity.current
    var scale by remember { mutableStateOf(0f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var lastJump by remember { mutableStateOf<String?>(null) }

    val nodes = remember(rows) { rows.nodes.associateBy { it.id } }
    val doors = remember(rows) { rows.nodes.associate { n -> n.id to FlowLayout.doorsOf(rows, n.id) } }
    val gives = remember(rows) { rows.effects.filter { it.choiceId != null && it.operation == "grant" }.associate { e -> e.choiceId!! to (rows.stateVars.firstOrNull { it.id == e.stateVarId }?.slug ?: "?") } }
    val gates = remember(rows) { rows.gates.associateBy { it.choiceId } }
    val reachable = remember(layout) { layout.boxes.keys - layout.unreachable }

    // Clipped: a canvas draws past its own edges unless told not to, and the
    // zoomed-out chart was painting over the header and the tabs.
    BoxWithConstraints(modifier.fillMaxSize().clipToBounds()) {
        val w = constraints.maxWidth.toFloat()
        val h = constraints.maxHeight.toFloat()
        fun centreOn(id: String, s: Float) {
            val b = layout.boxes[id] ?: return
            offset = Offset(w / 2 - b.cx * s, h * 0.08f - b.y * s)
        }
        // Set after layout, never during it: writing state while composing
        // makes Compose run the composition again, and again.
        LaunchedEffect(w, h) {
            if (scale == 0f) {
                // Open at a readable size, with the entrance near the top.
                scale = startScale ?: (w * 0.62f / FlowLayout.W).coerceIn(0.4f, 4f)
                if (startScale != null) offset = Offset(w / 2 - (layout.minX + layout.width / 2) * scale, h / 2 - layout.height / 2 * scale)
                else rows.story.rootNodeId?.let { centreOn(it, scale) } ?: run { offset = Offset(w / 2 - layout.minX * scale, 40f) }
            }
        }
        /** Frame an area: as wide as the screen allows, never past readable, its top near the top. */
        fun frame(x0: Float, y0: Float, x1: Float, y1: Float) {
            val readable = (w * 0.62f / FlowLayout.W).coerceIn(0.4f, 4f)
            val s = (w * 0.94f / (x1 - x0)).coerceIn(0.08f, readable)
            scale = s
            val tall = (y1 - y0) * s > h
            offset = Offset(w / 2 - (x0 + x1) / 2 * s, if (tall) h * 0.06f - y0 * s else h / 2 - (y0 + y1) / 2 * s)
        }
        LaunchedEffect(jumpTo) {
            if (jumpTo == null || jumpTo == lastJump || scale <= 0f) return@LaunchedEffect
            lastJump = jumpTo
            val target = jumpTo.substringBefore('#')
            when {
                target == "all" -> layout.boxes.values.takeIf { it.isNotEmpty() }?.let { bs ->
                    frame(bs.minOf { it.x }, bs.minOf { it.y }, bs.maxOf { it.x + FlowLayout.W }, bs.maxOf { it.bottom })
                }
                target.startsWith("chapter:") -> layout.chapters.firstOrNull { it.name == target.removePrefix("chapter:") }?.let { c ->
                    frame(c.x0 - 40f, c.y0 - 60f, c.x1 + 40f, c.y1)
                }
                else -> centreOn(target, scale)
            }
        }
        if (scale == 0f) return@BoxWithConstraints

        fun toLayout(p: Offset) = Offset((p.x - offset.x) / scale, (p.y - offset.y) / scale)

        Canvas(
            Modifier.fillMaxSize()
                .pointerInput(Unit) {
                    fun tap(p: Offset) {
                        val layout = latest.value
                        val q = toLayout(p)
                        // Circles first: they sit on the box edge.
                        layout.ports.firstOrNull { hypot(q.x - it.x, q.y - it.y) < 16f }?.let { return onChoice(it.choiceId) }
                        for (e in layout.edges) if (e is Edge.Loop) {
                            val (x, y) = e.from
                            if (q.x in x - 90f..x + 90f && q.y in y + 22f..y + 46f) { focus(e.to); return }
                        }
                        val b = layout.boxes.values.firstOrNull { q.x in it.x..(it.x + FlowLayout.W) && q.y in it.y..it.bottom } ?: return
                        val head = FlowLayout.headerH(b.titleLines.size)
                        val list = doors[b.id].orEmpty()
                        when {
                            q.y > b.bottom - FlowLayout.BUTTONS -> when (((q.x - b.x) / (FlowLayout.W / 3)).toInt()) {
                                0 -> onScene(b.id)
                                1 -> if (nodes[b.id]?.nodeType != "ending") onAddChoice(b.id) else onScene(b.id)
                                else -> onPlayFrom(b.id)
                            }
                            q.y > b.y + head && nodes[b.id]?.nodeType != "ending" -> {
                                val i = ((q.y - b.y - head - 3f) / FlowLayout.ROW).toInt()
                                list.getOrNull(i)?.let { onChoice(it.id) } ?: onScene(b.id)
                            }
                            else -> onScene(b.id)
                        }
                    }
                    /** What a long press picks up: a box, or else the chapter lane it's inside (or its name). */
                    fun grab(p: Offset): String? {
                        val layout = latest.value
                        val q = toLayout(p)
                        layout.boxes.values.firstOrNull { q.x in it.x..(it.x + FlowLayout.W) && q.y in it.y..it.bottom }?.let { return it.id }
                        val label = maxOf(24f, 18f / scale) * 1.3f
                        // The innermost: holding inside "Path A" moves Path A; holding Mike's own margin moves all of Mike.
                        return layout.chapters.filter { q.x in it.x0..it.x1 && q.y in (it.y0 - label)..it.y1 }.maxByOrNull { it.depth }?.let { "chapter:" + it.name }
                    }
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        // Wait for the finger to lift, move, add a second finger — or stay put long enough to be a long press.
                        val early: androidx.compose.ui.input.pointer.PointerEvent? = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                            var ev: androidx.compose.ui.input.pointer.PointerEvent
                            do {
                                ev = awaitPointerEvent()
                                val c = ev.changes.first()
                                val done = ev.changes.size > 1 || !c.pressed || (c.position - down.position).getDistance() > viewConfiguration.touchSlop
                            } while (!done)
                            ev
                        }
                        val target = if (early == null) grab(down.position) else null
                        if (early == null && target != null) {
                            // Long press: pick up a box or a lane and move it.
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            var moved = Offset.Zero
                            drag = target to moved
                            while (true) {
                                val ev = awaitPointerEvent()
                                val c = ev.changes.first()
                                if (!c.pressed) break
                                moved += (c.position - c.previousPosition) / scale
                                c.consume()
                                drag = target to moved
                            }
                            drag = null
                            if (moved.getDistance() > 2f) onNudge(target, moved.x, moved.y)
                            return@awaitEachGesture
                        }
                        // A long press on nothing just carries on as a pan.
                        val first = early ?: awaitPointerEvent()
                        if (first.changes.size == 1 && !first.changes.first().pressed) { tap(down.position); return@awaitEachGesture }
                        // Pan and pinch.
                        var ev = first
                        while (true) {
                            val zoom = ev.calculateZoom(); val pan = ev.calculatePan(); val centroid = ev.calculateCentroid(useCurrent = true)
                            if (zoom != 1f || pan != Offset.Zero) {
                                val newScale = (scale * zoom).coerceIn(0.08f, 6f)
                                val k = newScale / scale
                                val cpt = if (centroid == Offset.Unspecified) Offset(w / 2, h / 2) else centroid
                                offset = Offset(cpt.x - (cpt.x - offset.x) * k, cpt.y - (cpt.y - offset.y) * k) + pan
                                scale = newScale
                            }
                            ev.changes.forEach { it.consume() }
                            if (ev.changes.none { it.pressed }) break
                            ev = awaitPointerEvent()
                        }
                    }
                },
        ) {
            val px = density.density
            val blocks = scale * 1f < 0.28f
            fun style(size: Float, color: Color, bold: Boolean = false, family: FontFamily = FontFamily.Monospace) =
                TextStyle(fontSize = (size / px / density.fontScale).sp, color = color, fontFamily = family, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
            fun DrawScope.text(t: String, x: Float, y: Float, st: TextStyle, maxW: Float? = null) {
                val layoutResult = measurer.measure(t, st, maxLines = 1, softWrap = false)
                val dx = if (maxW != null && layoutResult.size.width > maxW) 0f else 0f
                drawText(layoutResult, topLeft = Offset(x + dx, y))
            }

            withTransform({ translate(offset.x, offset.y); scale(scale, scale, pivot = Offset.Zero) }) {
                val stroke = 1.5f
                // ---- chapters: a dashed frame per lane, named at the top ----
                // Names stay readable however far out you zoom: that is when you navigate by them.
                val labelSize = maxOf(24f, 18f / scale)
                for (ch in layout.chapters) {
                    drawRoundRect(Phosphor.dim, Offset(ch.x0, ch.y0), Size(ch.x1 - ch.x0, ch.y1 - ch.y0), CornerRadius(14f),
                        style = Stroke(maxOf(2f, 1.5f / scale), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f / minOf(scale, 1f), 10f / minOf(scale, 1f)))))
                    text(ch.label.uppercase(), ch.x0 + 14f, ch.y0 - labelSize * 1.1f, style(if (ch.depth > 1) labelSize * 0.8f else labelSize, if (ch.depth > 1) Phosphor.cyan else Phosphor.fg, family = Phosphor.font))
                }
                // ---- edges ----
                fun curve(a: Offset, b: Offset, color: Color, dashed: Boolean = false) {
                    val path = Path().apply { moveTo(a.x, a.y); cubicTo(a.x, a.y + 70f, b.x, b.y - 70f, b.x, b.y) }
                    drawPath(path, color, style = Stroke(stroke, pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(6f, 5f)) else null))
                    val head = Path().apply { moveTo(b.x, b.y); lineTo(b.x - 5f, b.y - 9f); lineTo(b.x + 5f, b.y - 9f); close() }
                    drawPath(head, color)
                }
                for (e in layout.edges) {
                    val (x, y) = e.from
                    val from = Offset(x, y + 9f)
                    when (e) {
                        is Edge.Forward -> layout.boxes[e.to]?.let { t -> curve(from, Offset(t.cx, t.y - 1f), Phosphor.fg.copy(alpha = 0.8f)) }
                        is Edge.Loop -> if (!blocks) {
                            drawLine(Phosphor.fg, from, Offset(x, y + 24f), stroke)
                            val label = "↺ " + (nodes[e.to]?.title?.ifBlank { nodes[e.to]?.slug } ?: "?").take(22)
                            val tl = measurer.measure(label, style(11f, Phosphor.cyan))
                            val w0 = tl.size.width + 14f
                            drawRoundRect(Phosphor.bg, Offset(x - w0 / 2, y + 24f), Size(w0, 20f), CornerRadius(10f))
                            drawRoundRect(Phosphor.cyan, Offset(x - w0 / 2, y + 24f), Size(w0, 20f), CornerRadius(10f), style = Stroke(1.2f))
                            drawText(tl, topLeft = Offset(x - w0 / 2 + 7f, y + 26f))
                        }
                        is Edge.Nowhere -> Unit
                        is Edge.Fork -> {
                            val d = Offset(x, y + 44f)
                            drawLine(Phosphor.fg, from, Offset(d.x, d.y - 12f), stroke)
                            val dia = Path().apply { moveTo(d.x, d.y - 12f); lineTo(d.x + 12f, d.y); lineTo(d.x, d.y + 12f); lineTo(d.x - 12f, d.y); close() }
                            drawPath(dia, Phosphor.bg); drawPath(dia, Phosphor.warn, style = Stroke(1.5f))
                            if (!blocks) text(e.item.let { if (it.length > 26) it.take(25) + "…" else it } + "?", d.x + 16f, d.y - 30f, style(10.5f, Phosphor.warn))
                            e.yes?.let { t -> layout.boxes[t]?.let { b -> curve(Offset(d.x, d.y + 12f), Offset(b.cx, b.y - 1f), Phosphor.fg.copy(alpha = 0.8f)) } }
                            e.no?.let { t ->
                                layout.boxes[t]?.let { b ->
                                    val nx = d.x + 44f
                                    drawLine(Phosphor.alert, Offset(d.x + 12f, d.y), Offset(nx, d.y), stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 4f)))
                                    curve(Offset(nx, d.y), Offset(b.cx + 20f, b.y - 1f), Phosphor.alert, dashed = true)
                                }
                            }
                            if (!blocks) { text("yes", d.x - 26f, d.y + 12f, style(10f, Phosphor.dim)); text("no", d.x + 28f, d.y + 4f, style(10f, Phosphor.dim)) }
                        }
                    }
                }

                // ---- scenes ----
                for (b in layout.boxes.values) {
                    val n = nodes[b.id] ?: continue
                    val sel = b.id == selected
                    val ending = n.nodeType == "ending"
                    val loose = b.id !in reachable
                    val written = n.narration.isNotBlank()
                    val recorded = !n.audioPath.isNullOrEmpty()
                    drawRoundRect(if (recorded) Phosphor.raise else Phosphor.panel, Offset(b.x, b.y), Size(FlowLayout.W, b.h), CornerRadius(7f))
                    drawRoundRect(
                        when { sel -> Phosphor.hi; loose -> Phosphor.alert; !written -> Phosphor.dim; else -> Phosphor.fg },
                        Offset(b.x, b.y), Size(FlowLayout.W, b.h), CornerRadius(7f),
                        style = Stroke(if (sel) 3f else 1.5f, pathEffect = if (loose || !written) PathEffect.dashPathEffect(floatArrayOf(6f, 4f)) else null),
                    )
                    if (blocks) {
                        val fill = when { loose -> Phosphor.alert; recorded -> Phosphor.fg; written -> Phosphor.dim; else -> Phosphor.line }
                        drawRoundRect(fill, Offset(b.x + 8f, b.y + 8f), Size(FlowLayout.W - 16f, b.h - 16f), CornerRadius(4f))
                        continue
                    }
                    // Status line.
                    val meta = buildList {
                        if (b.id == rows.story.rootNodeId) add("▶ START" to Phosphor.fg)
                        if (ending) add((if (n.endingKind == "win") "◎ WIN" else "✕ DEATH") to (if (n.endingKind == "win") Phosphor.fg else Phosphor.alert))
                        add(if (recorded) "▣ REC" to Phosphor.fg else if (written) "□ NO AUDIO" to Phosphor.warn else "┈ EMPTY" to Phosphor.warn)
                        if (loose) add("NOTHING LEADS HERE" to Phosphor.alert)
                    }
                    var mx = b.x + 10f
                    for ((t, c) in meta) { text(t, mx, b.y + 7f, style(10f, c)); mx += t.length * 6.6f + 10f }
                    b.titleLines.forEachIndexed { i, t -> text(t, b.x + 10f, b.y + 24f + i * FlowLayout.TITLE_LINE, style(14f, Phosphor.hi, bold = true)) }

                    val head = FlowLayout.headerH(b.titleLines.size)
                    val list = if (ending) emptyList() else doors[b.id].orEmpty()
                    if (list.isNotEmpty()) drawLine(Phosphor.line, Offset(b.x, b.y + head), Offset(b.x + FlowLayout.W, b.y + head), 1f)
                    list.forEachIndexed { i, c ->
                        val ry = b.y + head + 3f + i * FlowLayout.ROW
                        val marks = buildList {
                            gates[c.id]?.let { g -> add((if (g.failBehavior == "divert") "◇fork" else "◇needs") to Phosphor.warn) }
                            gives[c.id]?.let { add("+${it.lowercase().take(10)}" to Phosphor.fg) }
                            if (!c.reactionNarration.isNullOrBlank() || rows.dialogueLines.any { it.choiceId == c.id }) add((if (!c.audioPath.isNullOrEmpty()) "♪" else "“") to (if (!c.audioPath.isNullOrEmpty()) Phosphor.cyan else Phosphor.warn))
                            if (c.toNodeId == null) add("?" to Phosphor.alert)
                            else if (layout.edges.any { it.choiceId == c.id && it is Edge.Loop }) add("↺" to Phosphor.cyan)
                        }
                        val marksW = marks.sumOf { it.first.length + 1 } * 7f
                        val room = ((FlowLayout.W - 34f - marksW) / 6.9f).toInt().coerceAtLeast(6)
                        val words = c.label.ifBlank { "(no words yet)" }
                        text(c.digit, b.x + 10f, ry + 4f, style(11.5f, Phosphor.hi, bold = true))
                        text(if (words.length > room) words.take(room - 1) + "…" else words, b.x + 26f, ry + 4f, style(11.5f, if (c.label.isBlank()) Phosphor.dim else Phosphor.fg))
                        var rx = b.x + FlowLayout.W - 8f
                        for ((t, col) in marks.reversed()) {
                            val tl = measurer.measure(t, style(11f, col, bold = true))
                            rx -= tl.size.width
                            drawText(tl, topLeft = Offset(rx, ry + 4f)); rx -= 5f
                        }
                    }
                    // Buttons.
                    val labels = listOf("✎ EDIT", if (ending) "—" else "+ CHOICE", "▶ PLAY")
                    val bw = (FlowLayout.W - 16f - 8f) / 3
                    labels.forEachIndexed { i, t ->
                        val bx = b.x + 8f + i * (bw + 4f)
                        val by = b.bottom - 30f
                        drawRoundRect(Phosphor.bg, Offset(bx, by), Size(bw, 22f), CornerRadius(3f))
                        drawRoundRect(Phosphor.line, Offset(bx, by), Size(bw, 22f), CornerRadius(3f), style = Stroke(1f))
                        val tl = measurer.measure(t, style(10.5f, Phosphor.fg))
                        drawText(tl, topLeft = Offset(bx + (bw - tl.size.width) / 2, by + (22f - tl.size.height) / 2))
                    }
                }
                // ---- circles, on top of the box edge ----
                if (!blocks) for (p in layout.ports) {
                    drawCircle(Phosphor.bg, 9f, Offset(p.x, p.y))
                    drawCircle(if (p.nowhere) Phosphor.alert else Phosphor.fg, 9f, Offset(p.x, p.y), style = Stroke(1.5f))
                    val tl = measurer.measure(if (p.nowhere) "?" else p.digit, style(11f, if (p.nowhere) Phosphor.alert else Phosphor.hi, bold = true))
                    drawText(tl, topLeft = Offset(p.x - tl.size.width / 2, p.y - tl.size.height / 2))
                }
            }
        }
    }
}
