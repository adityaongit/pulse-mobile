package app.pulse.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PulseWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PulseWidgets")
    Function("hasWidgets") {
      val ctx = context()
      val manager = AppWidgetManager.getInstance(ctx)
      listOf(PulseSmallWidgetProvider::class.java, PulseMediumWidgetProvider::class.java, PulseLargeWidgetProvider::class.java).any { manager.getAppWidgetIds(ComponentName(ctx, it)).isNotEmpty() }
    }
    AsyncFunction("epoch") { WidgetCache.epoch(context()) }
    AsyncFunction("publish") { snapshot: String, epoch: Double ->
      val ctx = context()
      if (WidgetCache.write(ctx, snapshot, epoch.toLong())) updateAllWidgets(ctx)
    }
    AsyncFunction("clear") { val ctx = context(); WidgetCache.clear(ctx); updateAllWidgets(ctx) }
    Function("isPinSupported") { Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(context()).isRequestPinAppWidgetSupported }
    Function("requestPin") { size: String ->
      val ctx = context()
      val provider = when (size) {
        "small" -> PulseSmallWidgetProvider::class.java
        "medium" -> PulseMediumWidgetProvider::class.java
        "large" -> PulseLargeWidgetProvider::class.java
        else -> throw IllegalArgumentException("Unknown widget size")
      }
      val manager = AppWidgetManager.getInstance(ctx)
      Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported && manager.requestPinAppWidget(ComponentName(ctx, provider), null, null)
    }
  }
  private fun context(): Context = appContext.reactContext?.applicationContext ?: throw IllegalStateException("App context unavailable")
}
