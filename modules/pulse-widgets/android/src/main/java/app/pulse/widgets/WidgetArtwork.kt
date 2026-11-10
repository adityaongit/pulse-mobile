package app.pulse.widgets

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import java.util.Locale
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * RemoteViews supports ImageView, not custom Views, and a widget host inflates TextViews in a restricted context that
 * ignores font resources. So everything set in Pulse type (Barlow numbers, Figtree labels) is a bounded Canvas bitmap,
 * drawn for one theme: `night` picks values-night colours, whatever the app process is showing.
 */
internal class WidgetArtwork(base: Context, night: Boolean) {
  private val context = base.createConfigurationContext(Configuration(base.resources.configuration).apply {
    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
  })
  private val density = base.resources.displayMetrics.density.coerceAtMost(3f)
  private val fontScale = base.resources.configuration.fontScale.coerceIn(1f, 1.3f)
  private fun color(id: Int) = context.getColor(id)
  private val fg = color(R.color.pulse_widget_fg)
  private val secondary = color(R.color.pulse_widget_secondary)
  private val muted = color(R.color.pulse_widget_muted)
  private val track = color(R.color.pulse_widget_track)
  private val card = color(R.color.pulse_widget_card)
  private val cardTop = color(R.color.pulse_widget_card_top)
  private val cardEdge = color(R.color.pulse_widget_card_edge)
  private val warning = color(R.color.pulse_widget_warning_text)
  private val red = color(R.color.pulse_widget_red)
  private val numeric = context.resources.getFont(R.font.barlow_bold)
  private val numericUnit = context.resources.getFont(R.font.barlow_semibold)
  private val labelFace = context.resources.getFont(R.font.figtree_bold)
  private val bodyFace = context.resources.getFont(R.font.figtree_medium)

  private fun image(width: Float, height: Float, draw: (Canvas) -> Unit): Bitmap {
    val bitmap = Bitmap.createBitmap(max(1, (width * density).toInt()), max(1, (height * density).toInt()), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(density, density)
    draw(canvas)
    return bitmap
  }
  /** Text sizes in dp follow the system font scale; ring numbers do not (they are sized by the ring). */
  private fun paint(color: Int, size: Float, face: Typeface, tracking: Float = 0f, scaled: Boolean = true) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color; textSize = size * if (scaled) fontScale else 1f; typeface = face; letterSpacing = tracking
  }
  /** The app's 12 px label (uppercase, bold, 0.1 em tracking) and its 12 px muted caption, a step smaller for the widget. */
  private fun labelPaint(color: Int = fg, size: Float = 10.5f) = paint(color, size, labelFace, .1f)
  private fun captionPaint(size: Float = 10f) = paint(muted, size, bodyFace)
  private fun lineHeight(p: Paint) = p.textSize * 1.35f

  /** Shrinks to fit (down to 80 %), then ellipsizes: long labels in other languages stay readable. */
  private fun fitted(p: TextPaint, text: String, width: Float): String {
    val min = p.textSize * .8f
    while (p.measureText(text) > width && p.textSize > min) p.textSize *= .95f
    return TextUtils.ellipsize(text, p, width.coerceAtLeast(1f), TextUtils.TruncateAt.END).toString()
  }
  /** One line of text vertically centred on `centerY`. */
  private fun line(c: Canvas, text: String, x: Float, centerY: Float, width: Float, p: TextPaint, align: Paint.Align = Paint.Align.LEFT) {
    if (text.isBlank()) return
    p.textAlign = align
    val safe = fitted(p, text, width)
    c.drawText(safe, x, centerY - (p.fontMetrics.ascent + p.fontMetrics.descent) / 2, p)
  }
  /** Value and unit on one baseline, shrunk together to `width`. Returns the right edge. */
  private fun valueUnit(c: Canvas, value: String, unit: String, x: Float, baseline: Float, width: Float, valuePaint: TextPaint, unitPaint: TextPaint, center: Boolean): Float {
    val shown = if (value == "--") "" else unit
    val gap = if (shown.isBlank() || shown == "%") 1f else 3f
    fun length() = valuePaint.measureText(value) + if (shown.isBlank()) 0f else gap + unitPaint.measureText(shown)
    while (length() > width && valuePaint.textSize > 8f) { valuePaint.textSize *= .95f; unitPaint.textSize *= .95f }
    val left = if (center) x - length() / 2 else x
    c.drawText(value, left, baseline, valuePaint)
    if (shown.isNotBlank()) c.drawText(shown, left + valuePaint.measureText(value) + gap, baseline, unitPaint)
    return left + length()
  }
  /** Maps the snapshot's (light) data colour to the same token in this theme. */
  private fun dataColor(metric: JSONObject?): Int {
    val hex = metric?.optString("color")?.lowercase(Locale.ROOT).orEmpty()
    return DATA[hex]?.let(::color) ?: try { android.graphics.Color.parseColor(hex) } catch (_: IllegalArgumentException) { fg }
  }
  private fun heart(c: Canvas, x: Float, y: Float, size: Float) {
    c.save(); c.translate(x, y); c.scale(size / 24, size / 24)
    val path = Path().apply {
      moveTo(12f, 21f); cubicTo(8f, 18f, 1f, 13f, 1f, 7f)
      cubicTo(1f, 1f, 8f, -1f, 12f, 4f); cubicTo(16f, -1f, 23f, 1f, 23f, 7f)
      cubicTo(23f, 13f, 16f, 18f, 12f, 21f); close()
    }
    c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = red }); c.restore()
  }
  /** The card material: card-top fading to card, a 1 dp rim, 16 dp corners (the app's rounded-2xl). */
  private fun card(c: Canvas, rect: RectF) {
    val radius = min(16f, rect.height() / 2)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = LinearGradient(0f, rect.top, 0f, rect.bottom, cardTop, card, Shader.TileMode.CLAMP) }
    c.drawRoundRect(rect, radius, radius, fill)
    val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1f; color = cardEdge }
    c.drawRoundRect(RectF(rect.left + .5f, rect.top + .5f, rect.right - .5f, rect.bottom - .5f), radius, radius, rim)
  }

  /** A selected metric: Sleep, Recovery and Strain as Home's ring; the rest as a stat card, `inset` in from the cell's sides. */
  fun metric(metric: JSONObject?, key: String, label: String, valid: Boolean, caption: String, width: Float, height: Float, inset: Float): Bitmap = image(width, height) { c ->
    val value = if (valid) metric!!.optString("display", "--") else "--"
    val unit = if (valid) metric?.optString("unit").orEmpty() else ""
    if (key in RINGS) ring(c, metric, value, unit, label, valid, caption, width, height)
    else statCard(c, RectF(inset, 0f, width - inset, height), key, value, unit, label, caption)
  }

  /** Home's md dial (ScoreDial): the 4°-356° track and fill on a 92-unit box, the value in Barlow inside, the label under it. */
  private fun ring(c: Canvas, metric: JSONObject?, value: String, unit: String, label: String, valid: Boolean, caption: String, width: Float, height: Float) {
    val labelP = labelPaint()
    val captionP = captionPaint()
    val labelH = lineHeight(labelP)
    val captionH = if (caption.isBlank()) 0f else lineHeight(captionP)
    val d = min(min(width - 8, 112f), height - 4 - labelH - captionH).coerceAtLeast(24f)
    val top = max(0f, (height - d - 4 - labelH - captionH) / 2)
    val cx = width / 2; val cy = top + d / 2; val k = d / 92
    val r = d / 2 - 5 * k
    val oval = RectF(cx - r, cy - r, cx + r, cy + r)
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.BUTT; color = track; strokeWidth = 5.5f * k }
    c.drawArc(oval, -86f, 352f, false, stroke)
    val progress = metric?.optDouble("progress", Double.NaN) ?: Double.NaN
    if (valid && progress.isFinite() && progress > 0) {
      stroke.color = dataColor(metric); stroke.strokeWidth = 6 * k
      c.drawArc(oval, -86f, 352f * (progress.coerceIn(0.0, 100.0).toFloat() / 100f), false, stroke)
    }
    val hole = d - 16 * k
    val valueP = paint(if (valid) fg else muted, hole * .34f, numeric, -.01f, scaled = false)
    val unitP = paint(valueP.color, hole * .34f * .55f, numeric, scaled = false)
    val bounds = Rect().also { valueP.getTextBounds("0", 0, 1, it) }
    valueUnit(c, value, unit, cx, cy - (bounds.top + bounds.bottom) / 2f, hole * .88f, valueP, unitP, center = true)
    line(c, label.uppercase(Locale.getDefault()), cx, top + d + 4 + labelH / 2, width - 4, labelP, Paint.Align.CENTER)
    line(c, caption, cx, top + d + 4 + labelH + captionH / 2, width - 4, captionP, Paint.Align.CENTER)
  }

  /** The app's stat card: the label at the top, the value and unit (ValueUnit) at the foot, an honest-state caption under it. */
  private fun statCard(c: Canvas, rect: RectF, key: String, value: String, unit: String, label: String, caption: String) {
    card(c, rect)
    val pad = min(12f, rect.height() * .16f).coerceAtLeast(7f)
    val labelP = labelPaint(secondary, 9.5f)
    val captionP = captionPaint(9.5f)
    val labelH = lineHeight(labelP)
    val captionH = if (caption.isBlank()) 0f else lineHeight(captionP)
    val left = rect.left + pad; val inner = rect.width() - 2 * pad
    var labelLeft = left
    if (key == "heart_rate") { heart(c, left, rect.top + pad + labelH / 2 - 5, 10f); labelLeft += 13 }
    line(c, label.uppercase(Locale.getDefault()), labelLeft, rect.top + pad + labelH / 2, inner - (labelLeft - left), labelP)
    val room = rect.height() - 2 * pad - labelH - captionH
    val size = min(30f, room * .95f).coerceAtLeast(10f)
    val valueP = paint(if (value == "--") muted else fg, size, numeric, -.01f, scaled = false)
    val unitP = paint(secondary, max(9f, size * .42f), numericUnit, scaled = false)
    val baseline = rect.bottom - pad - captionH - (room - size * .72f).coerceAtLeast(0f) * .25f
    valueUnit(c, value, unit, left, baseline, inner, valueP, unitP, center = false)
    line(c, caption, left, rect.bottom - pad - captionH / 2, inner, captionP)
  }

  /** Home's heart-rate card: title, the heart and bpm, when it was read; the 30 minutes before it on the right. */
  fun heartRate(metric: JSONObject?, valid: Boolean, title: String, reading: String, window: String, width: Float, height: Float): Bitmap = image(width, height) { c ->
    card(c, RectF(0f, 0f, width, height))
    val pad = min(12f, height * .16f)
    val titleP = labelPaint(fg, 10.5f)
    val captionP = captionPaint()
    val titleH = lineHeight(titleP); val captionH = lineHeight(captionP)
    // The title row carries when the reading was taken, so the bpm gets the card's full height below it.
    val readingP = captionPaint()
    val titleText = title.uppercase(Locale.getDefault())
    val titleWidth = min(titleP.measureText(titleText), (width - 2 * pad) * .5f)
    line(c, titleText, pad, pad + titleH / 2, titleWidth, titleP)
    line(c, reading, width - pad, pad + titleH / 2, width - 2 * pad - titleWidth - 8, readingP, Paint.Align.RIGHT)
    val bodyTop = pad + titleH + 4; val bodyBottom = height - pad
    val size = min(36f, (bodyBottom - bodyTop) / .78f).coerceAtLeast(12f)
    val leftWidth = width * .46f - pad
    val baseline = bodyBottom - max(0f, (bodyBottom - bodyTop - size * .72f) / 2)
    val glyph = size * .55f
    heart(c, pad, baseline - size * .36f - glyph / 2, glyph)
    val valueP = paint(if (valid) fg else muted, size, numeric, -.01f, scaled = false)
    val unitP = paint(secondary, max(9f, size * .38f), numericUnit, scaled = false)
    valueUnit(c, if (valid) metric!!.optString("display", "--") else "--", if (valid) "bpm" else "", pad + glyph + 6, baseline, leftWidth - glyph - 6, valueP, unitP, center = false)
    if (!valid) return@image
    val series = metric?.optJSONArray("trend")
    val values = (0 until (series?.length() ?: 0)).map { i -> if (series!!.isNull(i)) null else series.optDouble(i, Double.NaN).takeIf { it.isFinite() } }
    val finite = values.filterNotNull()
    val left = width * .5f; val right = width - pad
    if (finite.isNotEmpty()) {
      val low = finite.min() - 3; val high = max(finite.max() + 3, low + 8)
      val top = bodyTop + 2; val bottom = bodyBottom - captionH - 4
      val path = Path(); var connected = false; var lastX = 0f; var lastY = 0f
      values.forEachIndexed { i, v ->
        // A missing minute is a gap: the line never runs across it.
        if (v == null) connected = false else {
          val x = left + (right - left) * i / max(1, values.size - 1)
          val y = bottom - (bottom - top) * ((v - low) / (high - low)).toFloat()
          if (connected) path.lineTo(x, y) else path.moveTo(x, y)
          connected = true; lastX = x; lastY = y
        }
      }
      c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = red; style = Paint.Style.STROKE; strokeWidth = 1.5f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND })
      c.drawCircle(lastX, lastY, 2.5f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = red })
    }
    line(c, window, left, height - pad - captionH / 2, right - left, captionP)
  }

  /** The footer: sync time, sample data or a stale warning (in the warning colour). */
  fun status(text: String, warn: Boolean, width: Float, height: Float): Bitmap = image(width, height) { c ->
    line(c, text, width / 2, height / 2, width, paint(if (warn) warning else muted, 10f, bodyFace), Paint.Align.CENTER)
  }

  companion object {
    val RINGS = setOf("sleep", "recovery", "strain")
    /**
     * src/widgets/model.ts sends light-theme hex colours (src/ui/palette.ts LIGHT) as names; each maps to the colour resource
     * of that token, whose values-night copy holds the dark value. src/widgets/model.test.ts fails if model.ts sends one
     * this map lacks. The last two are the red and sleep that older cached snapshots still carry.
     */
    private val DATA = mapOf(
      "#12c805" to R.color.pulse_widget_green, "#e5c300" to R.color.pulse_widget_yellow, "#f20024" to R.color.pulse_widget_red,
      "#0093e7" to R.color.pulse_widget_strain, "#6690ad" to R.color.pulse_widget_sleep, "#00b377" to R.color.pulse_widget_optimal,
      "#d97900" to R.color.pulse_widget_warning, "#3f92d3" to R.color.pulse_widget_blue,
      "#ff0026" to R.color.pulse_widget_red, "#7ba1bb" to R.color.pulse_widget_sleep,
    )
  }
}
