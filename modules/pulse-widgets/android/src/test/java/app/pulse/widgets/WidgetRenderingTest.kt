package app.pulse.widgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.ImageView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WidgetRenderingTest {
  private val now = Instant.parse("2026-10-29T12:00:00Z").epochSecond
  private val keys = listOf("sleep", "recovery", "strain", "steps", "calories", "hrv")
  private fun snapshot(): JSONObject {
    val metrics = JSONArray()
    listOf(Triple("sleep", 87, "#7ba1bb"), Triple("recovery", 72, "#12c805"), Triple("strain", 58, "#0093e7"), Triple("steps", 4200, "#00b377"), Triple("calories", 1800, "#d97900"), Triple("hrv", 42, "#12c805")).forEach { (key, value, color) ->
      metrics.put(JSONObject().put("key", key).put("label", key).put("value", value).put("display", java.text.NumberFormat.getIntegerInstance(java.util.Locale.US).format(value)).put("unit", if (key in listOf("sleep", "recovery", "strain")) "%" else if (key == "hrv") "ms" else if (key == "calories") "kcal" else "").put("progress", if (value < 100) value else JSONObject.NULL).put("color", color).put("href", "pulse://$key"))
    }
    metrics.put(JSONObject().put("key", "heart_rate").put("label", "Heart rate").put("value", 68).put("display", "68").put("unit", "bpm").put("observedAt", now - 480).put("trend", JSONArray((0..29).map { if (it in 12..14) JSONObject.NULL else 65 + it % 8 })))
    return JSONObject().put("version", 1).put("day", "2026-10-29").put("timeZone", "UTC").put("source", "health_connect").put("lastSyncTs", now - 60).put("metrics", metrics)
  }
  private fun render(size: WidgetSize, width: Int, height: Int, name: String, data: JSONObject? = snapshot(), chosen: List<String> = keys): View {
    val context = RuntimeEnvironment.getApplication() as Context
    val views = widgetViews(context, 31, size, data, chosen.take(size.count), width.toFloat(), height.toFloat(), now)
    val view = views.apply(context, null)
    val density = context.resources.displayMetrics.density
    val w = (width * density).toInt(); val h = (height * density).toInt()
    view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, w, h)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    view.draw(Canvas(bitmap))
    val output = File("build/widget-previews").apply { mkdirs() }
    File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    val count = size.count
    val ids = listOf(R.id.widget_art_1, R.id.widget_art_2, R.id.widget_art_3, R.id.widget_art_4, R.id.widget_art_5, R.id.widget_art_6).take(count)
    for (id in ids + if (size == WidgetSize.LARGE) listOf(R.id.widget_heart_card) else emptyList()) {
      val image = view.findViewById<ImageView>(id)
      assertNotNull(image.drawable)
      var y = image.top; var parent = image.parent
      while (parent is View && parent !== view) { y += parent.top; parent = parent.parent }
      assertTrue("$name: image $id clips below widget ($y + ${image.height} > $h)", y + image.height <= h)
      assertTrue("$name: image $id clips above widget", y >= 0)
      val footer = view.findViewById<View>(R.id.widget_status)
      assertTrue("$name: image $id overlaps sync footer", y + image.height <= footer.top + 2)
    }
    return view
  }
  @Test fun layoutsFitDeclaredMinimumsAndNormalLauncherSizes() {
    RuntimeEnvironment.setQualifiers("w360dp-h800dp-night-xhdpi")
    render(WidgetSize.SMALL, 110, 140, "small-min")
    render(WidgetSize.MEDIUM, 250, 140, "medium-min")
    render(WidgetSize.LARGE, 250, 280, "large-min")
    render(WidgetSize.LARGE, 340, 360, "large-dark")
    RuntimeEnvironment.setQualifiers("w360dp-h800dp-notnight-xhdpi")
    render(WidgetSize.LARGE, 340, 360, "large-light")
    val context = RuntimeEnvironment.getApplication() as Context
    val configuration = android.content.res.Configuration(context.resources.configuration).apply { fontScale = 1.3f }
    context.resources.updateConfiguration(configuration, context.resources.displayMetrics)
    render(WidgetSize.LARGE, 250, 280, "large-large-font")
  }
  @Test @Config(sdk = [30]) fun minimumLayoutAlsoFitsBeforeAndroid12() {
    RuntimeEnvironment.setQualifiers("w360dp-h800dp-night-xhdpi")
    render(WidgetSize.LARGE, 250, 280, "large-android11")
  }
  @Test fun demoWidgetsClearlyLabelSyntheticData() {
    val data = snapshot().put("source", "demo")
    RuntimeEnvironment.setQualifiers("w360dp-h800dp-night-xhdpi")
    val large = render(WidgetSize.LARGE, 340, 360, "pr-large-dark", data)
    assertEquals("Sample data", large.findViewById<android.widget.TextView>(R.id.widget_status).text.toString())
    render(WidgetSize.MEDIUM, 300, 170, "pr-medium", data)
    render(WidgetSize.SMALL, 140, 180, "pr-small-score", data)
    render(WidgetSize.SMALL, 140, 180, "pr-small-heart", data, listOf("heart_rate"))
    RuntimeEnvironment.setQualifiers("w360dp-h800dp-notnight-xhdpi")
    render(WidgetSize.LARGE, 340, 360, "pr-large-light", data)
  }
  @Test fun oldDayAndMissingDataRenderWithoutRetainingValues() {
    val old = snapshot().put("day", "2026-10-28")
    val view = render(WidgetSize.LARGE, 300, 320, "old-day", old)
    assertTrue(view.findViewById<View>(R.id.widget_cell_1).contentDescription.contains("--"))
    assertTrue(view.findViewById<View>(R.id.widget_heart_card).contentDescription.contains("--"))
    render(WidgetSize.SMALL, 110, 140, "missing", null)
  }
  @Test fun heartRateCanBeSelectedInSmallWidgetAndHasItsOwnTimestamp() {
    val view = render(WidgetSize.SMALL, 140, 180, "small-heart", chosen = listOf("heart_rate"))
    assertTrue(view.findViewById<View>(R.id.widget_cell_1).contentDescription.contains("68 bpm"))
    assertTrue(view.findViewById<View>(R.id.widget_cell_1).contentDescription.contains("Reading"))
  }
  @Test fun oldHeartReadingIsExplicitInSmallWidget() {
    val data = snapshot()
    val metrics = data.getJSONArray("metrics")
    metrics.getJSONObject(metrics.length() - 1).put("observedAt", now - 4 * 3600)
    val view = render(WidgetSize.SMALL, 140, 180, "small-old-heart", data, listOf("heart_rate"))
    assertTrue(view.findViewById<View>(R.id.widget_cell_1).contentDescription.contains("Older reading"))
  }
  @Test fun oldCacheAndConfiguredMetricsSurviveUpgradeButNotReset() {
    val context = RuntimeEnvironment.getApplication() as Context
    WidgetCache.clear(context)
    val data = snapshot()
    val records = data.getJSONArray("metrics")
    val heart = records.getJSONObject(records.length() - 1)
    records.remove(records.length() - 1)
    listOf("rhr", "stress").forEach { records.put(JSONObject().put("key", it).put("value", JSONObject.NULL)) }
    val epoch = WidgetCache.epoch(context)
    assertTrue(WidgetCache.write(context, data.toString(), epoch))
    assertEquals(8, WidgetCache.read(context)!!.getJSONArray("metrics").length())
    val oldSelection = listOf("recovery", "strain", "sleep", "steps", "calories", "hrv")
    WidgetCache.saveSelection(context, 55, oldSelection, WidgetSize.LARGE)
    assertEquals(oldSelection, WidgetCache.selection(context, 55, WidgetSize.LARGE))
    records.put(heart)
    assertTrue(WidgetCache.write(context, data.toString(), epoch))
    assertEquals(9, WidgetCache.read(context)!!.getJSONArray("metrics").length())
    WidgetCache.clear(context)
    assertFalse(WidgetCache.write(context, data.toString(), epoch))
    assertNull(WidgetCache.read(context))
  }
  @Test fun ringCapsOnlyProgressAndKeepsTheTrueStrainLabel() {
    val context = RuntimeEnvironment.getApplication() as Context
    val art = WidgetArtwork(context)
    val metric = JSONObject().put("display", "129").put("unit", "%").put("color", "#0093e7").put("progress", 129)
    val over = art.metric(metric, "strain", "Strain", true, "", 100f, 120f, false)
    val capped = art.metric(metric.put("progress", 100), "strain", "Strain", true, "", 100f, 120f, false)
    assertTrue(over.sameAs(capped))
    val label100 = art.metric(metric.put("display", "100"), "strain", "Strain", true, "", 100f, 120f, false)
    assertFalse(over.sameAs(label100))
  }
}
