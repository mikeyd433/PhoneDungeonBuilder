package com.jackie.dungeon.car

import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows

/**
 * The car screen's EDIT mode, as pure functions: what state it is in, and
 * what every tap does to that state. No Android and no GL, so all of it is
 * tested on the JVM (`CarEditorTest`); [CarView] draws a state, and the app
 * only carries out the [Effect]s and [Edit]s that [dispatch] hands back.
 *
 * The shape, settled with the author:
 *   - a MAP of the whole story (drag and pinch, or follow the phone), and a
 *     full-screen PAGE per scene: script, choices as tiles, items, recordings;
 *   - a toolbar of topic menus across the top — viewing on the map, editing
 *     on a scene page;
 *   - typing always happens on the phone, which opens whatever the car has
 *     open, and the car opens whatever the phone has open.
 */
enum class Mode { PLAY, EDIT }

/** What the map can light up, each in its own colour, only when asked to. */
enum class Highlight(val label: String) { EMPTY("EMPTY"), DEAD_END("DEAD END"), UNRECORDED("UNRECORDED") }

/** What the phone should open, because the car just opened it. */
sealed interface Focus {
    data class Scene(val id: String) : Focus
    data class Choice(val id: String) : Focus
}

/** Where the map is looking: a point in layout units, and source pixels per unit. */
data class Camera(val cx: Float, val cy: Float, val zoom: Float)

/** The car screen's size in its own (internal) pixels, and one character cell. */
data class Viewport(val w: Float, val h: Float, val cw: Float, val ch: Float)

sealed interface Popup {
    /** What a door requires, refuses or gives — tapped from its tile. */
    data class ItemInfo(val choiceId: String) : Popup
    /** "Play from here", with what to carry: slug -> 1 for items, n for counters. */
    data class PlayHere(val nodeId: String, val carrying: Map<String, Int> = emptyMap()) : Popup
    /** A sentence that goes away on the next tap. */
    data class Notice(val text: String) : Popup
}

data class CarState(
    val mode: Mode = Mode.PLAY,
    /** The scene page that is open, or null for the map. */
    val scene: String? = null,
    /** Scenes walked through to get here, for BACK. */
    val back: List<String> = emptyList(),
    /** The scene the map has picked out (what its SCENE menu acts on). */
    val selected: String? = null,
    /** The choice picked on a scene page (what CHOICE and ITEMS act on). */
    val choice: String? = null,
    /** Null until the map has been moved: then it sits on [selected] or the start. */
    val camera: Camera? = null,
    /** The open menu, as a path ("SCENE", "ENDING"); empty when closed. */
    val menu: List<String> = emptyList(),
    val popup: Popup? = null,
    val highlights: Set<Highlight> = emptySet(),
    /** First script row shown on a scene page. */
    val scriptScroll: Int = 0,
    /** First choice tile shown on a scene page. */
    val tileScroll: Int = 0,
)

sealed interface Action {
    /** A tap that should do nothing (a disabled menu entry, a popup's background). */
    data object None : Action
    // modes and pages
    data object ToPlay : Action
    data object ToEdit : Action
    data object ToMap : Action
    data object Back : Action
    data object Undo : Action
    data object Dismiss : Action
    data class OpenScene(val id: String) : Action
    data class SelectChoice(val id: String) : Action
    data class Menu(val path: List<String>) : Action
    data class ItemInfo(val choiceId: String) : Action
    data class EditOnPhone(val focus: Focus, val what: String) : Action
    data class PlayTake(val path: String) : Action

    // the map
    data object Fit : Action
    data object GoStart : Action
    data class ZoomBy(val factor: Float, val fx: Float? = null, val fy: Float? = null) : Action
    data class Pan(val dx: Float, val dy: Float) : Action
    data class GoChapter(val name: String) : Action
    data class Toggle(val h: Highlight) : Action

    // scrolling a scene page
    data class ScrollScript(val by: Int) : Action
    data class ScrollTiles(val by: Int) : Action

    // play from here
    data class PlayHere(val nodeId: String) : Action
    data class Carry(val slug: String, val n: Int) : Action
    data object StartCall : Action

    // edits
    data class SetEnding(val nodeId: String, val kind: String) : Action
    data class AddChoice(val nodeId: String) : Action
    data class MakeStart(val nodeId: String) : Action
    data class DeleteScene(val nodeId: String) : Action
    data class SetKey(val choiceId: String, val digit: String) : Action
    data class WireNew(val choiceId: String) : Action
    data class Unwire(val choiceId: String) : Action
    data class DeleteChoice(val choiceId: String) : Action
    data class Gives(val choiceId: String, val varId: String?) : Action
    data class Requires(val choiceId: String, val slug: String?) : Action
    /** Add or take away one item from what a choice needs. */
    data class ToggleNeed(val choiceId: String, val slug: String) : Action
    /** With several items: any one will do, or all are needed. */
    data class NeedAny(val choiceId: String, val any: Boolean) : Action
    data class Refuse(val choiceId: String) : Action
    data class ForkNew(val choiceId: String) : Action
}

/** Something only the app can do. */
sealed interface Effect {
    data class FocusPhone(val focus: Focus) : Effect
    data class PlayTake(val path: String) : Effect
    data class StartCall(val nodeId: String, val carrying: Map<String, Int>) : Effect
    data object Undo : Effect
}

/**
 * A change to the story. [run] is applied to the CURRENT rows (through the
 * undo stack) and says what the car should show afterwards; if it throws, the
 * story and the car are both left as they were.
 */
class Edit(val label: String, val run: (StoryRows) -> Pair<StoryRows, CarState>)

data class Outcome(val state: CarState, val effects: List<Effect> = emptyList(), val edit: Edit? = null)

object CarEditor {
    /** Car boxes are a fixed height, in layout units; only the layout's x and y are used. */
    const val BOX_H = 92f
    /** A box this many characters wide is the readable zoom. */
    const val READABLE_COLS = 22

    fun readableZoom(v: Viewport) = READABLE_COLS * v.cw / FlowLayout.W

    /** Where the map is looking when nobody has moved it: on the selected scene or the start. */
    fun camera(s: CarState, layout: FlowLayout.Layout, rows: StoryRows, v: Viewport): Camera =
        s.camera ?: centred(layout, s.selected ?: rows.story.rootNodeId, readableZoom(v))

    private fun centred(layout: FlowLayout.Layout, id: String?, zoom: Float): Camera {
        val b = layout.boxes[id] ?: layout.boxes.values.firstOrNull() ?: return Camera(0f, 0f, zoom)
        return Camera(b.cx, b.y + BOX_H / 2 + 60f, zoom)
    }

    private fun fit(layout: FlowLayout.Layout, v: Viewport): Camera {
        if (layout.boxes.isEmpty()) return Camera(0f, 0f, readableZoom(v))
        val x0 = layout.boxes.values.minOf { it.x }; val x1 = layout.boxes.values.maxOf { it.x + FlowLayout.W }
        val y0 = layout.boxes.values.minOf { it.y }; val y1 = layout.boxes.values.maxOf { it.y + BOX_H }
        val mapH = v.h - CarView.toolbarBottom(v) - v.ch
        val z = minOf((v.w - 2 * v.cw) / (x1 - x0 + 60f), mapH / (y1 - y0 + 80f))
        val cy = (y0 + y1) / 2 - (CarView.toolbarBottom(v) / 2) / z
        return Camera((x0 + x1) / 2, cy, z.coerceAtLeast(MIN_ZOOM))
    }

    const val MIN_ZOOM = 0.02f
    const val MAX_ZOOM = 3f

    /** The phone opened a scene: the car goes there too. */
    fun follow(s: CarState, rows: StoryRows, layout: FlowLayout.Layout, sceneId: String, v: Viewport?): CarState {
        if (rows.nodes.none { it.id == sceneId }) return s
        if (s.scene != null) {
            if (s.scene == sceneId) return s
            return s.copy(scene = sceneId, back = s.back + s.scene, choice = null, scriptScroll = 0, tileScroll = 0, menu = emptyList())
        }
        val zoom = s.camera?.zoom ?: v?.let(::readableZoom) ?: 1f
        return s.copy(selected = sceneId, camera = if (v == null) null else centred(layout, sceneId, zoom))
    }

    /** The phone opened a choice: show its scene, with it picked. */
    fun followChoice(s: CarState, rows: StoryRows, layout: FlowLayout.Layout, choiceId: String, v: Viewport?): CarState {
        val c = rows.choices.firstOrNull { it.id == choiceId } ?: return s
        val there = follow(s, rows, layout, c.fromNodeId, v)
        return there.copy(choice = if (there.scene == c.fromNodeId) choiceId else there.choice)
    }

    fun dispatch(s: CarState, rows: StoryRows, layout: FlowLayout.Layout, v: Viewport, a: Action): Outcome {
        val closed = s.copy(menu = emptyList(), popup = if (s.popup is Popup.Notice) null else s.popup)
        fun edit(label: String, after: (StoryRows) -> CarState = { closed }, f: (StoryRows) -> StoryRows) =
            Outcome(s, edit = Edit(label) { r -> val r2 = f(r); r2 to after(r2) })
        return when (a) {
            Action.None -> Outcome(s)
            Action.ToPlay -> Outcome(closed.copy(mode = Mode.PLAY, popup = null))
            Action.ToEdit -> Outcome(s.copy(mode = Mode.EDIT))
            Action.ToMap -> Outcome(closed.copy(scene = null, back = emptyList(), choice = null, selected = s.scene ?: s.selected,
                camera = s.scene?.let { centred(layout, it, camera(s, layout, rows, v).zoom) } ?: s.camera))
            Action.Back -> {
                val prev = s.back.lastOrNull()
                if (prev == null) dispatch(s, rows, layout, v, Action.ToMap)
                else Outcome(closed.copy(scene = prev, back = s.back.dropLast(1), choice = null, scriptScroll = 0, tileScroll = 0), listOf(Effect.FocusPhone(Focus.Scene(prev))))
            }
            Action.Undo -> Outcome(closed, listOf(Effect.Undo))
            Action.Dismiss -> Outcome(s.copy(menu = emptyList(), popup = null))
            is Action.OpenScene -> {
                if (rows.nodes.none { it.id == a.id }) return Outcome(closed)
                val back = if (s.scene != null && s.scene != a.id) s.back + s.scene else s.back
                Outcome(closed.copy(scene = a.id, back = back, selected = a.id, choice = null, scriptScroll = 0, tileScroll = 0, popup = null),
                    listOf(Effect.FocusPhone(Focus.Scene(a.id))))
            }
            is Action.SelectChoice -> Outcome(closed.copy(choice = a.id), listOf(Effect.FocusPhone(Focus.Choice(a.id))))
            is Action.Menu -> Outcome(s.copy(menu = if (a.path == s.menu) emptyList() else a.path, popup = null))
            is Action.ItemInfo -> Outcome(closed.copy(choice = a.choiceId, popup = Popup.ItemInfo(a.choiceId)), listOf(Effect.FocusPhone(Focus.Choice(a.choiceId))))
            is Action.EditOnPhone -> Outcome(closed.copy(popup = Popup.Notice("${a.what}: TYPE IT ON YOUR PHONE")), listOf(Effect.FocusPhone(a.focus)))
            is Action.PlayTake -> Outcome(closed, listOf(Effect.PlayTake(a.path)))

            Action.Fit -> Outcome(closed.copy(camera = fit(layout, v)))
            Action.GoStart -> Outcome(closed.copy(selected = rows.story.rootNodeId, camera = centred(layout, rows.story.rootNodeId, camera(s, layout, rows, v).zoom)))
            is Action.ZoomBy -> {
                val c = camera(s, layout, rows, v)
                val z = (c.zoom * a.factor).coerceIn(MIN_ZOOM, MAX_ZOOM)
                // Keep the point under the fingers where it is.
                val fx = a.fx ?: (v.w / 2); val fy = a.fy ?: (v.h / 2)
                val wx = c.cx + (fx - v.w / 2) / c.zoom; val wy = c.cy + (fy - v.h / 2) / c.zoom
                Outcome(closed.copy(camera = Camera(wx - (fx - v.w / 2) / z, wy - (fy - v.h / 2) / z, z)))
            }
            is Action.Pan -> {
                val c = camera(s, layout, rows, v)
                Outcome(s.copy(camera = c.copy(cx = c.cx - a.dx / c.zoom, cy = c.cy - a.dy / c.zoom)))
            }
            is Action.GoChapter -> {
                val first = rows.nodes.firstOrNull { it.chapter == a.name }?.id
                Outcome(closed.copy(selected = first ?: s.selected, camera = first?.let { centred(layout, it, camera(s, layout, rows, v).zoom) } ?: s.camera))
            }
            is Action.Toggle -> Outcome(s.copy(highlights = if (a.h in s.highlights) s.highlights - a.h else s.highlights + a.h))

            is Action.ScrollScript -> Outcome(s.copy(scriptScroll = (s.scriptScroll + a.by).coerceAtLeast(0)))
            is Action.ScrollTiles -> Outcome(s.copy(tileScroll = (s.tileScroll + a.by).coerceAtLeast(0)))

            is Action.PlayHere -> Outcome(closed.copy(popup = Popup.PlayHere(a.nodeId, (s.popup as? Popup.PlayHere)?.carrying ?: emptyMap())))
            is Action.Carry -> {
                val p = s.popup as? Popup.PlayHere ?: return Outcome(s)
                val next = if (a.n <= 0) p.carrying - a.slug else p.carrying + (a.slug to a.n.coerceAtMost(rows.story.counterClamp))
                Outcome(s.copy(popup = p.copy(carrying = next)))
            }
            Action.StartCall -> {
                val p = s.popup as? Popup.PlayHere ?: return Outcome(s)
                Outcome(s.copy(popup = null, menu = emptyList(), mode = Mode.PLAY), listOf(Effect.StartCall(p.nodeId, p.carrying)))
            }

            is Action.SetEnding -> edit("Change ending") { StoryEditor.updateScene(it, a.nodeId, kind = a.kind) }
            is Action.AddChoice -> {
                if (StoryEditor.freeKey(rows, a.nodeId) == null) return Outcome(closed.copy(popup = Popup.Notice("EVERY KEY IN THIS SCENE IS TAKEN")))
                Outcome(s, edit = Edit("Add choice") { r ->
                    val (r2, id) = StoryEditor.addChoice(r, a.nodeId, newScene = true)
                    val n = FlowLayout.doorsOf(r2, a.nodeId).indexOfFirst { it.id == id }
                    r2 to closed.copy(choice = id, tileScroll = (n - 2).coerceAtLeast(0), popup = Popup.Notice("NEW CHOICE: NAME IT ON YOUR PHONE"))
                }, effects = emptyList())
            }
            is Action.MakeStart -> edit("Change start") { StoryEditor.setEntrance(it, a.nodeId) }
            is Action.DeleteScene -> edit("Delete scene", after = { r ->
                val prev = s.back.lastOrNull { id -> r.nodes.any { it.id == id } }
                closed.copy(scene = prev, back = if (prev == null) emptyList() else s.back.dropLastWhile { it != prev }.dropLast(1), choice = null, selected = prev)
            }) { StoryEditor.deleteScene(it, a.nodeId) }
            is Action.SetKey -> edit("Change key") { StoryEditor.updateChoice(it, a.choiceId, digit = a.digit) }
            is Action.WireNew -> edit("Wire to new scene") { r ->
                val c = r.choices.first { it.id == a.choiceId }
                val (r2, scene) = StoryEditor.addScene(r, c.label, r.nodes.firstOrNull { it.id == c.fromNodeId }?.chapter)
                StoryEditor.updateChoice(r2, a.choiceId, to = scene)
            }
            is Action.Unwire -> edit("Unwire choice") { StoryEditor.updateChoice(it, a.choiceId, clearTo = true) }
            is Action.DeleteChoice -> edit("Delete choice", after = { closed.copy(choice = null) }) { StoryEditor.deleteChoice(it, a.choiceId) }
            is Action.Gives -> edit("Give item") { StoryEditor.setGives(it, a.choiceId, a.varId) }
            is Action.Requires -> edit("Require item") { r ->
                val g = r.gates.firstOrNull { it.choiceId == a.choiceId }
                StoryEditor.setRequires(r, a.choiceId, a.slug, g?.failBehavior?.takeIf { a.slug != null } ?: "refuse", failLine = g?.failNarration, failNode = g?.failNodeId)
            }
            // Ticking items keeps the menu open, so several can be ticked in a row.
            is Action.ToggleNeed -> edit("Change what it needs", after = { s.copy(popup = null) }) { StoryEditor.toggleNeed(it, a.choiceId, a.slug) }
            is Action.NeedAny -> edit(if (a.any) "Needs any one" else "Needs all", after = { s.copy(popup = null) }) { StoryEditor.setNeedAny(it, a.choiceId, a.any) }
            is Action.Refuse -> edit("Refuse") { r ->
                val need = StoryEditor.need(r, a.choiceId) ?: error("This choice doesn't need anything yet.")
                StoryEditor.setNeed(r, a.choiceId, need, "refuse", failLine = r.gates.firstOrNull { it.choiceId == a.choiceId }?.failNarration)
            }
            is Action.ForkNew -> edit("Fork to new scene") { r ->
                val need = StoryEditor.need(r, a.choiceId) ?: error("This choice doesn't need anything yet.")
                val (r2, scene) = StoryEditor.addScene(r, "Without " + StoryEditor.needWords(r, need).lowercase(), r.nodes.firstOrNull { n -> n.id == r.choices.first { it.id == a.choiceId }.fromNodeId }?.chapter)
                StoryEditor.setNeed(r2, a.choiceId, need, "divert", failNode = scene)
            }
        }
    }

    /**
     * What the phone is typing, shown on the car before it is saved: keys are
     * "title:<scene>", "script:<scene>", "label:<choice>", "reply:<choice>"
     * and "refuse:<choice>".
     */
    fun withDrafts(r: StoryRows, drafts: Map<String, String>): StoryRows {
        if (drafts.isEmpty()) return r
        fun d(kind: String, id: String) = drafts["$kind:$id"]
        return r.copy(
            nodes = r.nodes.map { n -> val t = d("title", n.id); val sc = d("script", n.id); if (t == null && sc == null) n else n.copy(title = t ?: n.title, narration = sc ?: n.narration) },
            choices = r.choices.map { c -> val l = d("label", c.id); val rp = d("reply", c.id); if (l == null && rp == null) c else c.copy(label = l ?: c.label, reactionNarration = rp ?: c.reactionNarration) },
            gates = r.gates.map { g -> d("refuse", g.choiceId)?.let { g.copy(failNarration = it) } ?: g },
        )
    }
}
