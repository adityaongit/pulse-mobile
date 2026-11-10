package app.pulse.workouts

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToLong

/**
 * One ongoing foreground-service notification, also used while paused or waiting for the sensor. It is the lock-screen
 * card too (docs/workout-tracker/whoop-ui.md § Ongoing notification): public, so the bpm and zone show without unlocking.
 */
internal object WorkoutNotification {
  const val CHANNEL = "pulse-workout-live"
  /** The first channel (private, low importance): removed, since a channel's settings cannot change. */
  const val OLD_CHANNEL = "pulse-workout-recording"
  private val ZONES = intArrayOf(R.id.pulse_workout_zone0, R.id.pulse_workout_zone1, R.id.pulse_workout_zone2, R.id.pulse_workout_zone3, R.id.pulse_workout_zone4, R.id.pulse_workout_zone5)
  private val LABELS = intArrayOf(R.id.pulse_workout_label0, R.id.pulse_workout_label1, R.id.pulse_workout_label2, R.id.pulse_workout_label3, R.id.pulse_workout_label4, R.id.pulse_workout_label5)
  private val COLORS = intArrayOf(R.color.pulse_workout_muted, R.color.pulse_workout_sleep, R.color.pulse_workout_strain, R.color.pulse_workout_optimal, R.color.pulse_workout_warning, R.color.pulse_workout_red)

  /** The engine's zones (src/core/engine/strain.ts zonesOf): each lower bound ceil(round1(maxHr · 50…90 %)); 0 below Zone 1. */
  fun zoneOf(bpm: Int, maxHr: Double): Int {
    val lowest = doubleArrayOf(0.5, 0.6, 0.7, 0.8, 0.9).map { ceil((maxHr * it * 10).roundToLong() / 10.0) }
    return lowest.count { bpm >= it }
  }

  fun enabled(ctx: Context): Boolean {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    return manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
  }

  fun build(ctx: Context, meta: JSONObject?, now: Long = System.currentTimeMillis()): Notification {
    fun label(key: String, fallback: Int) = meta?.optJSONObject("labels")?.optString(key)?.takeIf { it.isNotBlank() } ?: ctx.getString(fallback)
    val paused = meta?.optString("status") == "paused"
    val activeMs = (meta?.optLong("activeMs") ?: 0).coerceAtLeast(0)
    // The legacy link redirects to the tab after onboarding, and still supports first-run recording.
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("pulse:///workout-live"))
      .setClassName(ctx, "${ctx.packageName}.MainActivity")
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val pending = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = Notification.Builder(ctx, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(label("title", R.string.pulse_workout_title)).setContentIntent(pending)
      .setContentText(when {
        paused -> label("paused", R.string.pulse_workout_paused)
        meta?.optString("link") == "live" -> label("recording", R.string.pulse_workout_recording)
        else -> label("waiting", R.string.pulse_workout_waiting)
      })
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC)
      .setWhen(now - activeMs).setShowWhen(!paused).setUsesChronometer(!paused)
    if (paused) {
      val seconds = activeMs / 1000
      val duration = if (seconds >= 3600) String.format(Locale.getDefault(), "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
        else String.format(Locale.getDefault(), "%d:%02d", seconds / 60, seconds % 60)
      builder.setSubText(duration)
    }
    builder.setStyle(Notification.DecoratedCustomViewStyle())
      .setCustomContentView(card(ctx, meta, R.layout.pulse_workout_small, paused, activeMs, ::label))
      .setCustomBigContentView(card(ctx, meta, R.layout.pulse_workout_big, paused, activeMs, ::label))
    if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    val id = meta?.optString("id")
    if (!id.isNullOrBlank()) {
      for ((index, action) in listOf(if (paused) "resume" else "pause", "finish").withIndex()) {
        val intent = Intent(ctx, WorkoutService::class.java).setAction(action).putExtra("body", JSONObject().put("id", id).toString())
        val control = PendingIntent.getService(ctx, index + 10, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val resource = when (action) { "pause" -> R.string.pulse_workout_pause; "resume" -> R.string.pulse_workout_resume; else -> R.string.pulse_workout_finish }
        builder.addAction(Notification.Action.Builder(null, label(action, resource), control).build())
      }
    }
    return builder.build()
  }

  /** The activity and ♥ bpm, the elapsed time (frozen while paused), and the zone bar with the current zone lit. */
  private fun card(ctx: Context, meta: JSONObject?, layout: Int, paused: Boolean, activeMs: Long, label: (String, Int) -> String): RemoteViews {
    val views = RemoteViews(ctx.packageName, layout)
    views.setTextViewText(R.id.pulse_workout_name, label("name", R.string.pulse_workout_title))
    val bpm = meta?.optInt("lastBpm", 0)?.takeIf { it > 0 && !paused }
    views.setTextViewText(R.id.pulse_workout_bpm, "\u2665 ${bpm ?: "--"}")
    views.setChronometer(R.id.pulse_workout_timer, SystemClock.elapsedRealtime() - activeMs, null, !paused)
    if (layout != R.layout.pulse_workout_big) return views
    val maxHr = meta?.optJSONObject("strainSetup")?.optDouble("maxHr")?.takeIf { it > 0 } ?: meta?.optDouble("maxHr")?.takeIf { it > 0 }
    val zone = if (bpm != null && maxHr != null) zoneOf(bpm, maxHr) else -1
    val zoneLabel = label("zone", R.string.pulse_workout_zone)
    for (z in 0..5) {
      val color = ctx.getColor(COLORS[z])
      // The other zones at 35 %, as the app's zone bar dims them.
      val shown = if (z == zone) color else (color and 0x00ffffff) or (0x59 shl 24)
      views.setInt(ZONES[z], "setBackgroundColor", shown)
      views.setTextViewText(LABELS[z], String.format(Locale.getDefault(), zoneLabel, z))
      views.setTextColor(LABELS[z], shown)
    }
    return views
  }
}
