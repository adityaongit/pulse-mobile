package app.pulse.workouts

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.util.Locale

/** One ongoing foreground-service notification, also used while paused or waiting for the sensor. */
internal object WorkoutNotification {
  const val CHANNEL = "pulse-workout-recording"

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
      .setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
      .setWhen(now - activeMs).setShowWhen(!paused).setUsesChronometer(!paused)
    if (paused) {
      val seconds = activeMs / 1000
      val duration = if (seconds >= 3600) String.format(Locale.getDefault(), "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
        else String.format(Locale.getDefault(), "%d:%02d", seconds / 60, seconds % 60)
      builder.setSubText(duration)
    }
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
}
