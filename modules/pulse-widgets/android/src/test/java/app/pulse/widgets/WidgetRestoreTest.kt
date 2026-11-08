package app.pulse.widgets

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetRestoreTest {
  @Test fun restoreMovesEachChoiceToItsNewId() {
    val context = RuntimeEnvironment.getApplication() as Context
    WidgetCache.saveSelection(context, 1, listOf("steps"), WidgetSize.MEDIUM)
    WidgetCache.saveSelection(context, 2, listOf("hrv", "rhr"), WidgetSize.MEDIUM)
    // New ids overlap the old ones: widget 1 becomes 2, widget 2 becomes 3.
    PulseMediumWidgetProvider().onRestored(context, intArrayOf(1, 2), intArrayOf(2, 3))
    assertEquals(listOf("steps"), WidgetCache.selection(context, 2, WidgetSize.MEDIUM))
    assertEquals(listOf("hrv", "rhr"), WidgetCache.selection(context, 3, WidgetSize.MEDIUM))
    assertEquals(listOf("sleep", "recovery", "strain"), WidgetCache.selection(context, 1, WidgetSize.MEDIUM))
  }
}
