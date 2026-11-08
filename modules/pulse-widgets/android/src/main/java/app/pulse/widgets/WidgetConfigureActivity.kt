package app.pulse.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Every instance owns its metric selection. Cancelling a gallery add leaves RESULT_CANCELED. */
class WidgetConfigureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    val manager = AppWidgetManager.getInstance(this)
    val info = manager.getAppWidgetInfo(id)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID || info?.provider?.packageName != packageName) { finish(); return }
    val size = try { WidgetSize.of(info.provider.className) } catch (_: IllegalArgumentException) { finish(); return }
    val selected = (savedInstanceState?.getStringArrayList("selected") ?: WidgetCache.selection(this, id, size)).toMutableSet()
    val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(40), dp(24), dp(24)) }
    column.addView(TextView(this).apply { setText(R.string.pulse_widget_configure); textSize = 26f })
    column.addView(TextView(this).apply { text = getString(if (size == WidgetSize.LARGE) R.string.pulse_widget_choose_large else R.string.pulse_widget_choose, size.count); textSize = 15f; setPadding(0, dp(16), 0, dp(20)) })
    val snapshot = WidgetCache.read(this)?.optJSONArray("metrics")
    val names = mutableMapOf<String, String>()
    if (snapshot != null) for (i in 0 until snapshot.length()) snapshot.optJSONObject(i)?.let { names[it.optString("key")] = it.optString("label") }
    for (key in METRIC_KEYS.filter { size != WidgetSize.LARGE || it != "heart_rate" }) column.addView(CheckBox(this).apply {
      text = names[key]?.takeIf { it.isNotBlank() } ?: metricLabel(this@WidgetConfigureActivity, key)
      textSize = 17f
      minHeight = dp(48)
      isChecked = key in selected
      setOnCheckedChangeListener { view, checked ->
        if (checked && selected.size >= size.count) {
          view.isChecked = false
          Toast.makeText(this@WidgetConfigureActivity, getString(R.string.pulse_widget_too_many, size.count), Toast.LENGTH_SHORT).show()
        } else if (checked) selected.add(key) else selected.remove(key)
      }
    })
    column.addView(Button(this).apply {
      setText(R.string.pulse_widget_save)
      setOnClickListener {
        if (selected.isEmpty()) { Toast.makeText(this@WidgetConfigureActivity, R.string.pulse_widget_empty, Toast.LENGTH_SHORT).show(); return@setOnClickListener }
        WidgetCache.saveSelection(this@WidgetConfigureActivity, id, METRIC_KEYS.filter { it in selected }, size)
        renderWidget(this@WidgetConfigureActivity, manager, id)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        finish()
      }
    })
    column.addView(Button(this).apply { setText(R.string.pulse_widget_cancel); setOnClickListener { finish() } })
    setContentView(ScrollView(this).apply { addView(column) })
    selection = selected
  }
  private var selection: Set<String> = emptySet()
  override fun onSaveInstanceState(outState: Bundle) { outState.putStringArrayList("selected", ArrayList(selection)); super.onSaveInstanceState(outState) }
  private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
}
