package app.pulse.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30, 36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WidgetConfigureActivityTest {
  @Test fun pickerActionsAndSelectionsRemainVisibleAcrossThemesAndFontSizes() {
    for (night in listOf(false, true)) for (fontScale in listOf(1f, 2f)) {
      RuntimeEnvironment.setQualifiers("w320dp-h480dp-${if (night) "night" else "notnight"}-xhdpi")
      val context = RuntimeEnvironment.getApplication()
      val configuration = android.content.res.Configuration(context.resources.configuration).apply { this.fontScale = fontScale }
      context.resources.updateConfiguration(configuration, context.resources.displayMetrics)
      val manager = AppWidgetManager.getInstance(context)
      shadowOf(manager).addBoundWidget(49, AppWidgetProviderInfo().apply {
        provider = ComponentName(context, PulseMediumWidgetProvider::class.java)
      })
      val intent = Intent(context, WidgetConfigureActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 49)
      val controller = Robolectric.buildActivity(WidgetConfigureActivity::class.java, intent)
      val activity = controller.get()
      activity.setTheme(R.style.PulseWidgetConfigure)
      controller.setup()
      try {
        val content = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
        val scroll = content.getChildAt(0) as ScrollView
        val column = scroll.getChildAt(0) as LinearLayout
        val children = (0 until column.childCount).map { column.getChildAt(it) }
        val background = TypedValue()
        assertTrue(activity.theme.resolveAttribute(android.R.attr.colorBackground, background, true))
        val choices = children.filterIsInstance<CheckBox>()
        for (choice in choices) {
          val tint = requireNotNull(choice.buttonTintList) { "Selection tint must not depend on an OEM accent" }
          val checked = tint.getColorForState(intArrayOf(android.R.attr.state_enabled, android.R.attr.state_checked), 0)
          val unchecked = tint.getColorForState(intArrayOf(android.R.attr.state_enabled), 0)
          assertEquals(activity.getColor(R.color.pulse_widget_choice_checked), checked)
          assertNotEquals("Selected and unselected choices must be distinguishable", checked, unchecked)
          for (color in listOf(checked, unchecked)) {
            val light = maxOf(Color.luminance(color), Color.luminance(background.data))
            val dark = minOf(Color.luminance(color), Color.luminance(background.data))
            assertTrue("Selection indicators need 3:1 contrast (night=$night font=$fontScale indicator=${Integer.toHexString(color)} background=${Integer.toHexString(background.data)})", (light + 0.05f) / (dark + 0.05f) >= 3f)
          }
        }
        val buttons = (0 until column.childCount).map { column.getChildAt(it) }.filterIsInstance<Button>().filter { it !is android.widget.CompoundButton }
        assertEquals(2, buttons.size)
        val (save, cancel) = buttons
        // OEM themes may draw to every edge of the Button; spacing must belong to the layout.
        val buttonBackgrounds = buttons.map { it.background }
        buttons.forEach { it.background = ColorDrawable(0xff444444.toInt()) }
        val density = activity.resources.displayMetrics.density
        val width = (320 * density).toInt()
        val height = (480 * density).toInt()
        scroll.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        scroll.layout(0, 0, width, height)
        assertTrue("Save/Cancel need an actual gap independent of the button drawable", cancel.top - save.bottom >= (12 * density).toInt())
        assertTrue("Save must be separated from the last metric", save.top - column.getChildAt(column.indexOfChild(save) - 1).bottom >= (12 * density).toInt())
        buttons.forEach {
          assertEquals(column.width - column.paddingLeft - column.paddingRight, it.width)
          assertTrue("Action must have a usable touch height", it.height >= (48 * density).toInt())
        }
        scroll.isSmoothScrollingEnabled = false
        scroll.fullScroll(View.FOCUS_DOWN)
        assertTrue("Cancel must remain reachable by scrolling", cancel.bottom - scroll.scrollY <= scroll.height)
        // Preview the actual platform drawables; the zero-inset drawables above only stress layout.
        buttons.zip(buttonBackgrounds).forEach { (button, drawable) -> button.background = drawable }
        scroll.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        scroll.layout(0, 0, width, height)
        val output = File("build/widget-previews").apply { mkdirs() }
        val bitmap = Bitmap.createBitmap(column.width, column.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(background.data)
        column.draw(canvas)
        File(output, "configure-${android.os.Build.VERSION.SDK_INT}-${if (night) "dark" else "light"}-$fontScale.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        cancel.performClick()
        assertTrue(activity.isFinishing)
        assertEquals(Activity.RESULT_CANCELED, shadowOf(activity).resultCode)
      } finally { controller.pause().stop().destroy() }
    }
  }
}
