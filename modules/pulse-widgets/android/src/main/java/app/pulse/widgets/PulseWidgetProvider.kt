package app.pulse.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.format.DateUtils
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

open class PulseWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { ids.forEach { renderWidget(context, manager, it) } }
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) { renderWidget(context, manager, id) }
  override fun onDeleted(context: Context, ids: IntArray) { WidgetCache.remove(context, ids) }
}
class PulseSmallWidgetProvider : PulseWidgetProvider()
class PulseMediumWidgetProvider : PulseWidgetProvider()
class PulseLargeWidgetProvider : PulseWidgetProvider()

internal fun updateAllWidgets(context: Context) {
  val manager = AppWidgetManager.getInstance(context)
  listOf(PulseSmallWidgetProvider::class.java, PulseMediumWidgetProvider::class.java, PulseLargeWidgetProvider::class.java).forEach { provider ->
    manager.getAppWidgetIds(ComponentName(context, provider)).forEach { renderWidget(context, manager, it) }
  }
}
private val CELLS = arrayOf(
  intArrayOf(R.id.widget_cell_1, R.id.widget_art_1), intArrayOf(R.id.widget_cell_2, R.id.widget_art_2),
  intArrayOf(R.id.widget_cell_3, R.id.widget_art_3), intArrayOf(R.id.widget_cell_4, R.id.widget_art_4),
  intArrayOf(R.id.widget_cell_5, R.id.widget_art_5), intArrayOf(R.id.widget_cell_6, R.id.widget_art_6),
)

internal fun renderWidget(context: Context, manager: AppWidgetManager, id: Int) {
  val info = manager.getAppWidgetInfo(id) ?: return
  if (info.provider.packageName != context.packageName) return
  val size = try { WidgetSize.of(info.provider.className) } catch (_: IllegalArgumentException) { return }
  val options = manager.getAppWidgetOptions(id)
  val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
  val width = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, if (size == WidgetSize.SMALL) 140 else 300).coerceIn(100, 800)
  val height = options.getInt(if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, if (size == WidgetSize.LARGE) 320 else 160).coerceIn(110, 800)
  manager.updateAppWidget(id, widgetViews(context, id, size, WidgetCache.read(context), WidgetCache.selection(context, id, size), width.toFloat(), height.toFloat(), System.currentTimeMillis() / 1000))
}

/** Host-independent renderer; JVM tests inflate and draw these exact layouts, without a device or launcher. */
internal fun widgetViews(context: Context, id: Int, size: WidgetSize, snapshot: JSONObject?, chosen: List<String>, width: Float, height: Float, now: Long): RemoteViews {
  val zone = TimeZone.getTimeZone(snapshot?.optString("timeZone") ?: TimeZone.getDefault().id)
  val date = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply { timeZone = zone }
  val sameDay = snapshot != null && snapshot.optString("day") == date.format(Date(now * 1000))
  val labels = snapshot?.optJSONObject("labels")
  fun label(key: String, fallback: Int) = labels?.optString(key)?.takeIf { it.isNotBlank() } ?: context.getString(fallback)
  fun age(ts: Long) = DateUtils.getRelativeTimeSpanString(ts * 1000, now * 1000, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
  fun clock(ts: Long) = android.text.format.DateFormat.getTimeFormat(context).apply { timeZone = zone }.format(Date(ts * 1000))
  val synced = snapshot?.optDouble("lastSyncTs", Double.NaN)?.takeIf { it.isFinite() && it > 0 }?.toLong()
  val status = when {
    snapshot == null -> label("open", R.string.pulse_widget_open)
    !sameDay -> label("today", R.string.pulse_widget_today)
    snapshot?.optString("source") == "demo" -> label("demo", R.string.pulse_widget_demo)
    synced == null || synced > now + 300 || now - synced > 3 * 60 * 60 -> label("stale", R.string.pulse_widget_stale)
    else -> label("updated", R.string.pulse_widget_updated) + " " + clock(synced)
  }
  val views = RemoteViews(context.packageName, size.layout)
  views.setTextViewText(R.id.widget_status, status)
  views.setOnClickPendingIntent(R.id.widget_root, openPulse(context, id, "pulse:///"))
  val configure = Intent(context, WidgetConfigureActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
  views.setOnClickPendingIntent(R.id.widget_configure, PendingIntent.getActivity(context, id, configure, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
  val metrics = mutableMapOf<String, JSONObject>()
  val records = snapshot?.optJSONArray("metrics")
  if (records != null) for (i in 0 until records.length()) records.optJSONObject(i)?.let { metrics[it.optString("key")] = it }
  val art = WidgetArtwork(context)
  val bodyHeight = (height - 68).coerceAtLeast(50f)
  val heartHeight = (bodyHeight * .30f).coerceIn(56f, 96f)
  val statsHeight = (bodyHeight * .21f).coerceIn(36f, 64f)
  val topHeight = if (size == WidgetSize.LARGE) (bodyHeight - heartHeight - statsHeight - 16).coerceIn(50f, 132f) else bodyHeight.coerceAtMost(168f)
  val columnWidth = (width - 24) / if (size == WidgetSize.SMALL) 1 else 3
  fun valid(metric: JSONObject?, key: String): Boolean {
    if (!sameDay || metric == null || metric.isNull("value") || !metric.optDouble("value", Double.NaN).isFinite()) return false
    if (key != "heart_rate") return true
    val at = metric.optDouble("observedAt", Double.NaN)
    return metric.optDouble("value") > 0 && at.isFinite() && at > 0 && at <= now
  }
  fun caption(metric: JSONObject?, key: String, usable: Boolean): String = when {
    !sameDay -> "" // The footer explains the empty day once, rather than repeating it in every tile.
    !usable -> metric?.optString("reason")?.takeIf { it != "null" && it.isNotBlank() } ?: label("open", R.string.pulse_widget_open)
    key == "heart_rate" -> metric!!.optDouble("observedAt").toLong().let { at ->
      if (now - at > 3 * 60 * 60) label("oldReading", R.string.pulse_widget_oldReading) + " · " + age(at)
      else label("reading", R.string.pulse_widget_reading) + " " + clock(at)
    }
    metric!!.optBoolean("provisional") -> label("provisional", R.string.pulse_widget_provisional)
    else -> ""
  }
  for (index in 0 until size.count) {
    val cell = CELLS[index]
    val key = chosen.getOrNull(index)
    views.setViewVisibility(cell[0], if (key == null) View.GONE else View.VISIBLE)
    if (key == null) continue
    val metric = metrics[key]
    val title = metric?.optString("label")?.takeIf { it.isNotBlank() } ?: metricLabel(context, key)
    val usable = valid(metric, key)
    val reason = caption(metric, key, usable)
    val compact = size == WidgetSize.LARGE && index >= 3
    val tileHeight = if (compact) statsHeight else topHeight
    views.setImageViewBitmap(cell[1], art.metric(metric, key, title, usable, reason, columnWidth, tileHeight, compact))
    if (Build.VERSION.SDK_INT >= 31) views.setViewLayoutHeight(cell[1], tileHeight, TypedValue.COMPLEX_UNIT_DIP)
    val value = if (usable) metric!!.optString("display") + " " + metric.optString("unit") else "--"
    views.setContentDescription(cell[0], listOf(title, value, reason).filter { it.isNotBlank() }.joinToString(", "))
    views.setOnClickPendingIntent(cell[0], openPulse(context, id, metric?.optString("href")?.takeIf { it.startsWith("pulse://") } ?: "pulse:///"))
  }
  if (size == WidgetSize.LARGE) {
    val metric = metrics["heart_rate"]
    val usable = valid(metric, "heart_rate")
    val title = metric?.optString("label")?.takeIf { it.isNotBlank() } ?: metricLabel(context, "heart_rate")
    val reading = if (!usable) label("noReading", R.string.pulse_widget_noReading) else {
      val at = metric!!.optDouble("observedAt").toLong()
      (if (now - at > 3 * 60 * 60) label("oldReading", R.string.pulse_widget_oldReading) else clock(at)) + " · " + age(at)
    }
    views.setImageViewBitmap(R.id.widget_heart_card, art.heartRate(metric, usable, title, reading, label("heartWindow", R.string.pulse_widget_heartWindow), width - 24, heartHeight))
    if (Build.VERSION.SDK_INT >= 31) views.setViewLayoutHeight(R.id.widget_heart_card, heartHeight, TypedValue.COMPLEX_UNIT_DIP)
    views.setContentDescription(R.id.widget_heart_card, title + ", " + (if (usable) metric!!.optString("display") + " bpm, " else "--, ") + reading)
    views.setOnClickPendingIntent(R.id.widget_heart_card, openPulse(context, id, "pulse://health/heart-rate"))
  }
  return views
}
private fun openPulse(context: Context, id: Int, href: String): PendingIntent {
  val intent = Intent(Intent.ACTION_VIEW, Uri.parse(href)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}
internal fun metricLabel(context: Context, key: String): String = context.getString(when (key) {
  "recovery" -> R.string.pulse_widget_metric_recovery
  "strain" -> R.string.pulse_widget_metric_strain
  "sleep" -> R.string.pulse_widget_metric_sleep
  "steps" -> R.string.pulse_widget_metric_steps
  "calories" -> R.string.pulse_widget_metric_calories
  "hrv" -> R.string.pulse_widget_metric_hrv
  "rhr" -> R.string.pulse_widget_metric_rhr
  "heart_rate" -> R.string.pulse_widget_metric_heart_rate
  else -> R.string.pulse_widget_metric_stress
})
