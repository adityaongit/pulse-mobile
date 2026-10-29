package app.pulse.widgets

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File

/** Private, non-backed-up summary only. Neither the widget host nor this module can query SQLite or Health Connect. */
internal object WidgetCache {
  private val lock = Any()
  private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "pulse-widget-snapshot.json"))
  private fun settings(context: Context) = context.getSharedPreferences("pulse_widget_options", Context.MODE_PRIVATE)
  fun epoch(context: Context): Long = synchronized(lock) { settings(context).getLong("epoch", 0L) }
  fun read(context: Context): JSONObject? = synchronized(lock) {
    try {
      val bytes = file(context).openRead().use { it.readBytes() }
      if (bytes.size > 65_536) null else JSONObject(String(bytes, Charsets.UTF_8)).takeIf { it.optInt("version") == 1 }
    } catch (_: Exception) { null }
  }
  fun write(context: Context, text: String, expectedEpoch: Long): Boolean = synchronized(lock) {
    require(text.toByteArray(Charsets.UTF_8).size <= 65_536) { "Widget snapshot is too large" }
    val data = JSONObject(text)
    require(data.optInt("version") == 1 && (data.optJSONArray("metrics")?.length() ?: 0) in 8..9) { "Unsupported widget snapshot" }
    if (epoch(context) != expectedEpoch) return false
    val target = file(context)
    val stream = target.startWrite()
    try { stream.write(text.toByteArray(Charsets.UTF_8)); target.finishWrite(stream) }
    catch (error: Exception) { target.failWrite(stream); throw error }
    true
  }
  fun clear(context: Context) = synchronized(lock) {
    // Invalidate publications that began before reset, including a headless JS runtime.
    val saved = settings(context).edit().putLong("epoch", epoch(context) + 1).commit()
    file(context).delete()
    check(saved)
  }
  fun selection(context: Context, id: Int, size: WidgetSize): List<String> {
    val saved = settings(context).getString("metrics_$id", null)?.split(',').orEmpty().filter { it in METRIC_KEYS && (size != WidgetSize.LARGE || it != "heart_rate") }.distinct()
    return saved.take(size.count).ifEmpty { DEFAULT_KEYS.take(size.count) }
  }
  fun saveSelection(context: Context, id: Int, selected: List<String>, size: WidgetSize) {
    require(selected.isNotEmpty() && selected.size <= size.count && selected.distinct().size == selected.size && selected.all { it in METRIC_KEYS })
    check(settings(context).edit().putString("metrics_$id", selected.joinToString(",")).commit())
  }
  fun remove(context: Context, ids: IntArray) {
    settings(context).edit().apply { ids.forEach { remove("metrics_$it") } }.apply()
  }
}
internal val METRIC_KEYS = listOf("sleep", "recovery", "strain", "steps", "calories", "hrv", "rhr", "stress", "heart_rate")
private val DEFAULT_KEYS = listOf("sleep", "recovery", "strain", "steps", "calories", "hrv")
internal enum class WidgetSize(val count: Int, val layout: Int) {
  SMALL(1, R.layout.pulse_widget_small), MEDIUM(3, R.layout.pulse_widget_medium), LARGE(6, R.layout.pulse_widget_large);
  companion object {
    fun of(className: String): WidgetSize = when (className) {
      PulseSmallWidgetProvider::class.java.name -> SMALL
      PulseMediumWidgetProvider::class.java.name -> MEDIUM
      PulseLargeWidgetProvider::class.java.name -> LARGE
      else -> throw IllegalArgumentException("Unknown Pulse widget provider")
    }
  }
}
