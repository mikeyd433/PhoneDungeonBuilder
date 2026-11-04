package com.jackie.dungeon.car

import com.jackie.dungeon.call.CallSession
import com.jackie.dungeon.engine.StoryPack
import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.PackBuilder
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The car editor without a car: every tap is an [Action] dispatched on a
 * state, and every frame is checked for what it says and what it does when
 * tapped. With JD_CAR_FRAMES=<dir>, the frames are also written out as JSON
 * so the WebGL bench can put them through the real CRT shaders.
 */
class CarEditorTest {
    private fun rows(name: String) = StoryRows.parse(javaClass.getResource("/golden/$name.rows.json")!!.readText())
    private val william = rows("william")
    private val kitchen = rows("kitchen")
    /** An 800x480 head unit: 600x360 inside, at the M text size. */
    private val v = Viewport(600f, 360f, 9f, 21f)

    private class Bench(var r: StoryRows, val v: Viewport, var s: CarState = CarState(mode = Mode.EDIT)) {
        val effects = ArrayList<Effect>()
        var undo = ArrayList<StoryRows>()
        fun layout() = FlowLayout.layout(r)
        fun frame() = CarView.render(r, layout(), s, v, MapInfo.of(r, s.highlights), undo.isNotEmpty())
        fun go(a: Action): Bench {
            val o = CarEditor.dispatch(s, r, layout(), v, a)
            s = o.state
            effects += o.effects
            o.edit?.let { e -> val (r2, s2) = e.run(r); undo += r; r = r2; s = s2 }
            return this
        }
        /** Tap whatever the frame has labelled [text]. */
        fun tap(text: String): Bench {
            val f = frame()
            val op = f.ops.filterIsInstance<Op.Text>().lastOrNull { it.text.trim() == text || it.text.trim().endsWith(text) }
                ?: error("no \"$text\" on screen: " + f.texts().joinToString(" | "))
            val a = f.hit(op.x + v.cw / 2, op.y + v.ch / 2) ?: error("\"$text\" does nothing")
            return go(a)
        }
        fun says(text: String) = frame().texts().any { it.contains(text) }
    }

    private fun dump(name: String, b: Bench) {
        val dir = System.getenv("JD_CAR_FRAMES") ?: return
        val f = b.frame()
        val ops = f.ops.joinToString(",\n") { op ->
            when (op) {
                is Op.Fill -> """{"f":[${op.x},${op.y},${op.w},${op.h}],"i":"${op.ink}"}"""
                is Op.Text -> """{"t":[${op.x},${op.y}],"s":${quote(op.text)},"i":"${op.ink}"}"""
            }
        }
        File(dir).mkdirs()
        File(dir, "$name.json").writeText("""{"w":${b.v.w},"h":${b.v.h},"cw":${b.v.cw},"ch":${b.v.ch},"ops":[$ops]}""")
    }

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    @Test
    fun `the map opens on the start, readable, with the toolbar`() {
        val b = Bench(william, v)
        assertTrue(b.says("PLAY MODE")); assertTrue(b.says("VIEW ▾")); assertTrue(b.says("UNDO"))
        val root = william.nodes.first { it.id == william.story.rootNodeId }
        assertTrue(b.frame().texts().any { it.startsWith("▶ ") }, "the start is marked")
        assertTrue(b.frame().hits.any { it.action == Action.OpenScene(root.id) }, "and tappable")
        dump("map", b)
    }

    @Test
    fun `tapping a scene opens its page, and leaves the phone where it is`() {
        val b = Bench(william, v)
        val root = william.story.rootNodeId!!
        b.go(Action.OpenScene(root))
        assertEquals(root, b.s.scene)
        assertTrue(b.effects.none { it is Effect.FocusPhone }, "the car never moves the phone")
        assertTrue(b.says("+ CHOICE")); assertTrue(b.says("▶ PLAY HERE")); assertTrue(b.says("‹ BACK"))
        val doors = FlowLayout.doorsOf(william, root)
        assertTrue(doors.isNotEmpty())
        val dest = doors.first().toNodeId!!
        assertTrue(b.frame().hits.any { it.action == Action.OpenScene(dest) }, "a tile walks to its scene")
        dump("scene", b)
        b.go(Action.OpenScene(dest))
        assertEquals(listOf(root), b.s.back)
        b.go(Action.Back)
        assertEquals(root, b.s.scene)
        b.go(Action.Back)
        assertNull(b.s.scene, "back from the first page is the map")
    }

    @Test
    fun `the toolbar's menus open, nest, and close`() {
        val b = Bench(william, v)
        b.tap("VIEW ▾")
        assertEquals(listOf("VIEW"), b.s.menu)
        assertTrue(b.says("FIT WHOLE STORY"))
        dump("menu-view", b)
        b.tap("VIEW ▾")
        assertTrue(b.s.menu.isEmpty(), "the same button closes it")
        b.tap("VIEW ▾").tap("FIT WHOLE STORY")
        assertTrue(b.s.menu.isEmpty())
        assertTrue(b.s.camera!!.zoom < CarEditor.readableZoom(v), "fit zooms out")
        dump("map-fit", b)
    }

    @Test
    fun `scene menu edits the ending, adds a choice, and undo is offered`() {
        val b = Bench(kitchen, v)
        val hall = kitchen.story.rootNodeId!!
        b.go(Action.OpenScene(hall))
        val before = FlowLayout.doorsOf(b.r, hall).size
        b.tap("+ CHOICE")
        assertEquals(before + 1, FlowLayout.doorsOf(b.r, hall).size)
        val made = b.s.choice
        assertNotNull(made, "the new choice is picked")
        assertTrue(b.s.popup is Popup.Notice)
        b.go(Action.Dismiss)
        b.tap("CHOICE ▾").tap("KEY: ${b.r.choices.first { it.id == made }.digit} ▸")
        assertTrue(b.says("PRESS 9"))
        b.tap("PRESS 9")
        assertEquals("9", b.r.choices.first { it.id == made }.digit)
        assertTrue(b.frame().hits.any { it.action == Action.Undo }, "undo is live after an edit")
    }

    @Test
    fun `items menu gives and requires, and the tile shows it`() {
        val b = Bench(kitchen, v)
        val hall = kitchen.story.rootNodeId!!
        b.go(Action.OpenScene(hall))
        val c = FlowLayout.doorsOf(b.r, hall).first { b.r.gates.none { g -> g.choiceId == it.id } }
        b.go(Action.SelectChoice(c.id))
        assertEquals(c.id, b.s.choice)
        val item = b.r.stateVars.first { it.kind == "item" }
        b.tap("ITEMS ▾").tap("NEEDS: NOTHING ▸").tap(item.name.uppercase())
        assertEquals(item.slug, StoryEditor.simpleRequirement(b.r, c.id))
        // The menu stays open: tick a second item, and make either one do.
        val other = b.r.stateVars.filter { it.kind != "counter" }.first { it.slug != item.slug }
        b.tap(other.name.uppercase()).tap("ANY ONE OF THESE")
        assertEquals(StoryEditor.Need(listOf(item.slug, other.slug), any = true), StoryEditor.need(b.r, c.id))
        b.go(Action.Dismiss)
        assertTrue(b.says("◆" + item.name.uppercase().take(3)))
        b.tap("ITEMS ▾").tap("IF THEY DON'T HAVE IT ▸").tap("GO TO A NEW SCENE")
        val g = b.r.gates.first { it.choiceId == c.id }
        assertEquals("divert", g.failBehavior)
        assertNotNull(b.r.nodes.firstOrNull { it.id == g.failNodeId })
        b.go(Action.ItemInfo(c.id))
        assertTrue(b.says("WITHOUT IT: GOES TO"))
        dump("item-info", b)
    }

    @Test
    fun `play from here asks what to carry, then starts the call with it`() {
        val b = Bench(kitchen, v)
        val hall = kitchen.story.rootNodeId!!
        b.go(Action.OpenScene(hall)).tap("▶ PLAY HERE")
        assertTrue(b.s.popup is Popup.PlayHere)
        val item = b.r.stateVars.first { it.kind == "item" }
        b.tap("□ " + item.name.uppercase())
        assertEquals(1, (b.s.popup as Popup.PlayHere).carrying[item.slug])
        dump("play-here", b)
        b.tap("START")
        assertEquals(Mode.PLAY, b.s.mode)
        val start = b.effects.last() as Effect.StartCall
        assertEquals(mapOf(item.slug to 1), start.carrying)

        val pack = PackBuilder.build(b.r).copy(root = start.nodeId)
        val call = CallSession(pack, start.carrying)
        call.dial()
        assertTrue(item.name in call.held(), "the call starts holding it: ${call.held()}")
    }

    @Test
    fun `highlights outline what they match, and only when switched on`() {
        val b = Bench(william, v)
        assertTrue(MapInfo.of(william, emptySet()).marks.isEmpty())
        b.go(Action.Toggle(Highlight.UNRECORDED)).go(Action.Toggle(Highlight.DEAD_END)).go(Action.Fit)
        val marks = MapInfo.of(william, b.s.highlights).marks
        assertTrue(marks.values.any { Highlight.UNRECORDED in it })
        assertTrue(b.says("UNRECORDED "))
        dump("map-highlights", b)
    }

    @Test
    fun `the car's map mirrors the phone's flowchart until the car's own map is moved`() {
        val b = Bench(william, v)
        val box = b.layout().boxes.values.last()
        // The phone shows a 400x900 area around a scene near the bottom.
        b.s = b.s.copy(phone = PhoneView(box.cx, box.y, 400f, 900f))
        val cam = CarEditor.camera(b.s, b.layout(), william, v)
        assertEquals(box.cx, cam.cx)
        assertEquals(v.w / CarEditor.MIRROR_MARGIN, 400f * cam.zoom, 0.5f, "what spans the phone spans most of the car, with room around it")
        // A scene zoomed in to fill the phone's width fills the car's.
        // As on a real phone: the flowchart area about 1.4 times as tall as wide, the box a little above its middle.
        val pw = FlowLayout.W * 1.1f; val ph = pw * 1.4f
        val close = CarEditor.mirrored(PhoneView(box.cx, box.y + box.h / 2 + 0.08f * ph, pw, ph), v)
        val boxW = FlowLayout.W * close.zoom
        assertTrue(boxW > v.w * 0.6f && boxW < v.w * 0.8f, "the box is $boxW of ${v.w}")
        // And the whole box is on the map: under the toolbar, above the bottom.
        val boxTop = (box.y - close.cy) * close.zoom + v.h / 2
        val boxBottom = (box.bottom - close.cy) * close.zoom + v.h / 2
        assertTrue(boxTop >= CarView.toolbarBottom(v) && boxBottom <= v.h, "box from $boxTop to $boxBottom")
        // The phone moves: so does the car.
        b.s = b.s.copy(phone = PhoneView(box.cx + 300f, box.y, 400f, 900f))
        assertEquals(box.cx + 300f, CarEditor.camera(b.s, b.layout(), william, v).cx)
        // Dragging the car's map stops it following, and says how to resume.
        b.go(Action.Pan(30f, 0f))
        assertFalse(b.s.mirror)
        assertTrue(b.says("FOLLOW PHONE"))
        b.s = b.s.copy(phone = PhoneView(0f, 0f, 400f, 900f))
        assertNotEquals(0f, CarEditor.camera(b.s, b.layout(), william, v).cx)
        b.tap("FOLLOW PHONE")
        assertTrue(b.s.mirror)
        assertEquals(0f, CarEditor.camera(b.s, b.layout(), william, v).cx)
        dump("map-mirror", b)
        // The phone as in the author's screenshot: Mike's intro, 734 of 923 px wide, a little above the middle.
        val mike = b.layout().boxes[william.nodes.first { it.slug == "GNOME_RUNS_BY_AND" }.id]!!
        val scale = 734f / FlowLayout.W
        val sw = 923f / scale; val sh = 1270f / scale
        b.s = b.s.copy(phone = PhoneView(mike.cx, mike.y - 348f / scale + sh / 2, sw, sh), scene = null)
        dump("map-mirror-phone", b)
    }

    @Test
    fun `the car's page mirrors the phone's sheet - open, switch, close, and back the other way`() {
        val b = Bench(william, v)
        val root = william.story.rootNodeId!!
        val other = william.nodes.last().id
        b.s = CarEditor.follow(b.s, william, b.layout(), root, v)
        assertEquals(root, b.s.scene, "a sheet open on the phone opens the scene's page on the car")
        b.s = CarEditor.follow(b.s, william, b.layout(), other, v)
        assertEquals(other, b.s.scene)
        assertTrue(b.s.back.isEmpty(), "following the phone isn't a walk to retrace with BACK")
        b.s = CarEditor.sheetClosed(b.s)
        assertNull(b.s.scene, "the sheet closed: back to the map")
        // Someone looks around on the car while the phone has a sheet open: the phone
        // is left alone, the car goes its own way, and FOLLOW PHONE rejoins the phone's sheet.
        b.s = CarEditor.follow(b.s, william, b.layout(), root, v)
        b.go(Action.ToMap)
        assertNull(b.s.scene)
        assertFalse(b.s.mirror)
        assertTrue(b.effects.none { it is Effect.FocusPhone }, "the phone's sheet stays open")
        assertTrue(b.says("FOLLOW PHONE"))
        b.s = CarEditor.follow(b.s, william, b.layout(), other, v)
        assertNull(b.s.scene, "on its own, the car isn't pulled to the phone's new sheet")
        b.tap("FOLLOW PHONE")
        assertTrue(b.s.mirror)
        assertEquals(other, b.s.scene, "following again: the phone's open sheet")
        // Walking somewhere from a page detaches too.
        b.go(Action.OpenScene(root))
        assertFalse(b.s.mirror)
        assertTrue(b.says("FOLLOW PHONE"), "and the scene page offers the way back")
        b.s = CarEditor.sheetClosed(b.s)
        assertEquals(root, b.s.scene, "the phone closing its sheet doesn't close the car's page")
        b.tap("FOLLOW PHONE")
        assertNull(b.s.scene, "the phone has no sheet open: following it is its map")
    }

    @Test
    fun `not following, the phone opening a sheet leaves the car's map alone`() {
        val b = Bench(william, v, CarState(mode = Mode.EDIT, mirror = false))
        val far = william.nodes.last().id
        val before = CarEditor.camera(b.s, b.layout(), william, v)
        b.s = CarEditor.follow(b.s, william, b.layout(), far, v)
        assertEquals(before, CarEditor.camera(b.s, b.layout(), william, v))
        assertNull(b.s.scene)
        assertEquals(far, b.s.phoneSheet)
    }

    @Test
    fun `drafts typed on the phone show before they are saved`() {
        val root = william.story.rootNodeId!!
        val drafted = CarEditor.withDrafts(william, mapOf("title:$root" to "A brand new name"))
        val b = Bench(drafted, v)
        b.go(Action.OpenScene(root))
        assertTrue(b.says("A BRAND NEW NAME"))
    }

    @Test
    fun `what is still silent sits in the top bar, not in the script`() {
        for ((rowsOnScreen, cw) in listOf(22 to 7f, 17 to 9f, 13 to 12f)) {
            val vv = Viewport(600f, 360f, cw, 360f / rowsOnScreen)
            val b = Bench(william, vv)
            b.go(Action.OpenScene(william.story.rootNodeId!!))
            val f = b.frame()
            val top = CarView.toolbarBottom(vv) * 2.5f
            val rec = f.ops.filterIsInstance<Op.Text>().filter { it.text.startsWith("SILENT") || it.text.startsWith("ALL RECORDED") }
            assertEquals(1, rec.size, "said once at $rowsOnScreen rows")
            assertTrue(rec.single().y < top, "in the bar at $rowsOnScreen rows, not at y=${rec.single().y}")
        }
    }

    @Test
    fun `every text size the editor uses (S to L) fits a toolbar and a scene page`() {
        for ((rowsOnScreen, cw) in listOf(22 to 7f, 17 to 9f, 13 to 12f)) {
            val vv = Viewport(600f, 360f, cw, 360f / rowsOnScreen)
            val b = Bench(william, vv)
            b.go(Action.OpenScene(william.story.rootNodeId!!))
            val f = b.frame()
            assertTrue(f.hits.any { it.action == Action.Undo || it.action == Action.ToPlay })
            assertTrue(f.ops.filterIsInstance<Op.Text>().all { it.x + it.text.length * vv.cw <= vv.w + 1 }, "nothing runs off the side at $rowsOnScreen rows")
            if (rowsOnScreen == 13) dump("scene-l", b)
            if (rowsOnScreen == 22) dump("scene-s", b)
        }
    }

    @Test
    fun `the terminal's corner tab goes back to edit`() {
        val f = CarView.playOverlay(v)
        assertEquals(Action.ToEdit, f.hit(v.w - 20f, 6f))
        assertFalse(f.hit(v.w / 2, v.h / 2) == Action.ToEdit)
    }

    @Test
    fun `a pack started carrying a counter sets it`() {
        val pack = StoryPack.parse(javaClass.getResource("/golden/kitchen.pack.json")!!.readText())
        val counter = pack.vars.firstOrNull { it.kind == "counter" } ?: return
        val call = CallSession(pack, mapOf(counter.slug to 2))
        call.dial()
        assertTrue(call.held().any { it.endsWith("×2") }, call.held().toString())
    }

    @Test
    fun `someone else's scene is marked on the car's map and page`() {
        val b = Bench(william, v)
        val root = william.story.rootNodeId!!
        b.s = b.s.copy(others = mapOf(root to listOf("Friend")))
        assertTrue(b.says("FRIEND"), "a tab on the box")
        b.go(Action.OpenScene(root))
        assertTrue(b.says("FRIEND IS HERE"))
    }

    @Test
    fun `the mirror's width and height follow the settings`() {
        val p = PhoneView(0f, 0f, 400f, 800f)
        val a = CarEditor.mirrored(p, v, 1f, 0f); val b2 = CarEditor.mirrored(p, v, 2f, 0.2f)
        assertEquals(2f, a.zoom / b2.zoom, 0.001f)
        assertTrue(b2.cy < a.cy, "shifted up")
    }
}
