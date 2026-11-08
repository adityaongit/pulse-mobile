package app.pulse.workouts

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WorkoutNotificationTest {
  private val ctx: Context get() = RuntimeEnvironment.getApplication()
  private fun meta(status: String = "recording", link: String = "live") = JSONObject()
    .put("id", "fixture-session").put("status", status).put("link", link).put("activeMs", 125_000)

  @Test fun recordingKeepsOneOngoingPrivateNotificationWithAnActiveTimer() {
    val n = WorkoutNotification.build(ctx, meta(), 1_000_000)
    assertTrue(n.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
    assertEquals(875_000L, n.`when`)
    assertTrue(n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    assertEquals("Recording", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
  }

  @Test fun pausedTimerIsFrozenAndResumeReplacesPause() {
    val n = WorkoutNotification.build(ctx, meta("paused"))
    assertTrue(n.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertFalse(n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    assertFalse(n.extras.getBoolean(Notification.EXTRA_SHOW_WHEN))
    assertEquals("2:05", n.extras.getCharSequence(Notification.EXTRA_SUB_TEXT).toString())
    assertEquals("resume", shadowOf(n.actions[0].actionIntent).savedIntent.action)
    assertEquals("finish", shadowOf(n.actions[1].actionIntent).savedIntent.action)
  }

  @Test fun sensorLossKeepsTheTimerAndPauseControl() {
    val n = WorkoutNotification.build(ctx, meta(link = "lost"))
    assertEquals("Waiting for heart rate", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    assertTrue(n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    assertEquals("pause", shadowOf(n.actions[0].actionIntent).savedIntent.action)
    assertEquals("fixture-session", JSONObject(shadowOf(n.actions[0].actionIntent).savedIntent.getStringExtra("body")!!).getString("id"))
  }

  @Test fun notificationReturnsToTheExistingWorkoutLink() {
    val n = WorkoutNotification.build(ctx, meta())
    val intent = shadowOf(n.contentIntent).savedIntent
    assertEquals("pulse:///workout-live", intent.data.toString())
    assertEquals("${ctx.packageName}.MainActivity", intent.component!!.className)
    assertTrue(shadowOf(n.contentIntent).isImmutable)
  }

  @Test fun blockedWorkoutChannelIsNotConsideredEnabled() {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(WorkoutNotification.CHANNEL, "Workout recording", NotificationManager.IMPORTANCE_NONE))
    assertFalse(WorkoutNotification.enabled(ctx))
  }
}
