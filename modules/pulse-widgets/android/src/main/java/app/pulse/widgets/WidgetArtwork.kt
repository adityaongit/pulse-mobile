package app.pulse.widgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import java.util.Locale
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** RemoteViews supports ImageView, not custom Views. These bounded bitmaps use real Android Canvas rendering. */
internal class WidgetArtwork(private val context: Context) {
  private val density = context.resources.displayMetrics.density.coerceAtMost(3f)
  private val fontScale = context.resources.configuration.fontScale.coerceIn(1f, 1.35f)
  private val foreground = context.getColor(R.color.pulse_widget_fg)
  private val muted = context.getColor(R.color.pulse_widget_muted)
  private val panel = context.getColor(R.color.pulse_widget_panel)
  private val track = context.getColor(R.color.pulse_widget_track)
  private val numberFace = Typeface.create("sans-serif-condensed", Typeface.BOLD)
  private val labelFace = Typeface.create("sans-serif", Typeface.BOLD)
  private val regularFace = Typeface.create("sans-serif", Typeface.NORMAL)

  private fun image(width: Float, height: Float, draw: (Canvas) -> Unit): Bitmap {
    val bitmap = Bitmap.createBitmap(max(1, (width * density).toInt()), max(1, (height * density).toInt()), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(density, density)
    draw(canvas)
    return bitmap
  }
  private fun paint(color: Int, size: Float = 12f, face: Typeface = regularFace) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color; textSize = size * fontScale; typeface = face
  }
  private fun text(c: Canvas, value: String, x: Float, y: Float, width: Float, size: Float, color: Int = muted, center: Boolean = false, bold: Boolean = false) {
    val p = paint(color, size, if (bold) labelFace else regularFace)
    p.textAlign = if (center) Paint.Align.CENTER else Paint.Align.LEFT
    val safe = TextUtils.ellipsize(value, TextPaint(p), width.coerceAtLeast(1f), TextUtils.TruncateAt.END).toString()
    c.drawText(safe, x, y, p)
  }
  private fun number(c: Canvas, value: String, unit: String, cx: Float, baseline: Float, width: Float, size: Float, color: Int = foreground) {
    val valuePaint = paint(color, size, numberFace)
    val unitPaint = paint(if (unit == "%") color else muted, size * 0.43f)
    val gap = if (unit.isBlank() || unit == "%") 0f else 3f
    fun length() = valuePaint.measureText(value) + gap + unitPaint.measureText(unit)
    while ((length() > width || valuePaint.fontSpacing > size * 1.2f) && valuePaint.textSize > 12f) { valuePaint.textSize *= .94f; unitPaint.textSize *= .94f }
    val left = cx - length() / 2
    c.drawText(value, left, baseline, valuePaint)
    c.drawText(unit, left + valuePaint.measureText(value) + gap, baseline, unitPaint)
  }
  private fun metricColor(metric: JSONObject?) = try { Color.parseColor(metric?.optString("color") ?: "#0093e7") } catch (_: IllegalArgumentException) { foreground }
  private fun heart(c: Canvas, x: Float, y: Float, size: Float) {
    c.save(); c.translate(x, y); c.scale(size / 24, size / 24)
    val path = Path().apply {
      moveTo(12f, 21f); cubicTo(8f, 18f, 1f, 13f, 1f, 7f)
      cubicTo(1f, 1f, 8f, -1f, 12f, 4f); cubicTo(16f, -1f, 23f, 1f, 23f, 7f)
      cubicTo(23f, 13f, 16f, 18f, 12f, 21f); close()
    }
    c.drawPath(path, paint(Color.rgb(255, 0, 38))); c.restore()
  }

  fun metric(metric: JSONObject?, key: String, label: String, valid: Boolean, caption: String, width: Float, height: Float, compact: Boolean): Bitmap = image(width, height) { c ->
    val value = if (valid) metric!!.optString("display", "--") else "--"
    val unit = if (valid) metric?.optString("unit").orEmpty() else ""
    val inset = 3f
    if (compact) {
      c.drawRoundRect(RectF(inset, 1f, width - inset, height - 1f), 14f, 14f, paint(panel))
      text(c, label.uppercase(Locale.ROOT), width / 2, 12f, width - 16, 9f, center = true, bold = true)
      number(c, value, unit, width / 2, height - if (caption.isBlank()) 9 else 18, width - 16, min(25f, (height - if (caption.isBlank()) 20 else 28) * .85f))
      if (caption.isNotBlank()) text(c, caption, width / 2, height - 5, width - 14, 8f, center = true)
    } else if (key in listOf("sleep", "recovery", "strain")) {
      val labelSpace = if (caption.isBlank()) 20f else 32f
      val diameter = min(width - 12, height - labelSpace - 4).coerceAtLeast(28f)
      val left = (width - diameter) / 2
      val top = max(2f, (height - labelSpace - diameter) / 2)
      val stroke = (diameter * .062f).coerceIn(3f, 7f)
      val ring = RectF(left + stroke / 2, top + stroke / 2, left + diameter - stroke / 2, top + diameter - stroke / 2)
      val ringPaint = paint(track).apply { style = Paint.Style.STROKE; strokeWidth = stroke; strokeCap = Paint.Cap.BUTT }
      c.drawArc(ring, -90f, 360f, false, ringPaint)
      val progress = metric?.optDouble("progress", Double.NaN) ?: Double.NaN
      if (valid && progress.isFinite()) {
        ringPaint.color = metricColor(metric)
        c.drawArc(ring, -90f, progress.coerceIn(0.0, 100.0).toFloat() * 3.6f, false, ringPaint)
      }
      number(c, value, unit, width / 2, top + diameter / 2 + diameter * .105f, diameter - 16, diameter * .33f, if (valid) foreground else muted)
      text(c, label.uppercase(Locale.ROOT), width / 2, top + diameter + 16, width - 4, 10f, foreground, center = true, bold = true)
      if (caption.isNotBlank()) text(c, caption, width / 2, height - 2, width - 6, 8f, center = true)
    } else {
      c.drawRoundRect(RectF(inset, 2f, width - inset, height - 2), 18f, 18f, paint(panel))
      if (key == "heart_rate") heart(c, width / 2 - 7, max(7f, height * .16f), 14f)
      number(c, value, unit, width / 2, height * .57f, width - 14, min(34f, height * .30f))
      text(c, label.uppercase(Locale.ROOT), width / 2, height * .79f, width - 12, 9f, foreground, center = true, bold = true)
      if (caption.isNotBlank()) text(c, caption, width / 2, height - 6, width - 12, 8f, center = true)
    }
  }

  fun heartRate(metric: JSONObject?, valid: Boolean, title: String, reading: String, window: String, width: Float, height: Float): Bitmap = image(width, height) { c ->
    c.drawRoundRect(RectF(0f, 0f, width, height), 18f, 18f, paint(panel))
    text(c, title.uppercase(Locale.ROOT), 14f, 16f, width - 30, if (height < 72) 8.8f else 10f, foreground, bold = true)
    val leftWidth = width * .46f
    val valueY = height * .64f
    heart(c, 14f, valueY - 17, 19f)
    number(c, if (valid) metric!!.optString("display", "--") else "--", if (valid) "bpm" else "", 35 + (leftWidth - 35) / 2, valueY, leftWidth - 35, min(39f, (height - 38) * .95f))
    text(c, reading, 14f, height - 10, leftWidth - 10, 9f)
    if (valid) {
      val series = metric?.optJSONArray("trend")
      val values = (0 until (series?.length() ?: 0)).map { i -> if (series!!.isNull(i)) null else series.optDouble(i, Double.NaN).takeIf { it.isFinite() } }
      val finite = values.filterNotNull()
      if (finite.isNotEmpty()) {
        val low = finite.min() - 3; val high = max(finite.max() + 3, low + 8)
        val left = width * .52f; val right = width - 14; val top = 29f; val bottom = height - 27
        val path = Path(); var connected = false
        val line = paint(muted).apply { style = Paint.Style.STROKE; strokeWidth = 1.4f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
        var lastX = 0f; var lastY = 0f
        values.forEachIndexed { i, v ->
          if (v == null) { connected = false } else {
            val x = left + (right - left) * i / max(1, values.size - 1)
            val y = bottom - (bottom - top) * ((v - low) / (high - low)).toFloat()
            if (connected) path.lineTo(x, y) else path.moveTo(x, y)
            connected = true; lastX = x; lastY = y
            c.drawCircle(x, y, .7f, paint(muted))
          }
        }
        c.drawPath(path, line); c.drawCircle(lastX, lastY, 2f, paint(foreground))
      }
      text(c, window.uppercase(Locale.ROOT), width * .52f, height - 10, width * .48f - 14, 8f)
    }
  }
}
