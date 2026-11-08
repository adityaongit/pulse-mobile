package app.pulse.workouts

import android.content.Context
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class WorkoutJournalTest {
  private lateinit var ctx: Context
  @Before fun setup() {
    ctx = RuntimeEnvironment.getApplication()
    File(ctx.filesDir, "workout-journal").deleteRecursively()
    File(ctx.filesDir, "workout-reset-pending").delete()
    WorkoutService.runningId = null
    WorkoutService.snapshot = null
  }
  @After fun cleanup() { WorkoutService.runningId = null; WorkoutService.snapshot = null }
  private fun meta(status: String = "recording") = JSONObject().put("id", "test-1")
    .put("status", status).put("revision", 1).put("activeMs", 5000)

  @Test fun processDeathIsInterruptedWithoutInventingTime() {
    WorkoutJournal.save(ctx, meta())
    WorkoutJournal.setActive(ctx, "test-1")
    val recovered = WorkoutJournal.active(ctx)!!
    assertEquals("interrupted", recovered.getString("status"))
    assertEquals(5000L, recovered.getLong("activeMs"))
    assertEquals(2L, recovered.getLong("revision"))
  }
  @Test fun healthyAndPausedSessionsAreNotMarkedInterrupted() {
    WorkoutJournal.save(ctx, meta())
    WorkoutJournal.setActive(ctx, "test-1")
    WorkoutService.runningId = "test-1"
    assertEquals("recording", WorkoutJournal.active(ctx)!!.getString("status"))
    WorkoutJournal.save(ctx, meta("paused"))
    WorkoutService.runningId = null
    assertEquals("paused", WorkoutJournal.active(ctx)!!.getString("status"))
  }
  @Test fun incompleteJournalTailDoesNotAdvanceTheCursor() {
    val file = WorkoutJournal.sampleFile(ctx, "test-1")
    val complete = "{\"seq\":1,\"bpm\":100}\n"
    file.writeText(complete + "{\"seq\":2")
    val page = JSONObject(WorkoutJournal.page(ctx, "test-1", 0))
    assertEquals(1, page.getJSONArray("samples").length())
    assertEquals(complete.length.toLong(), page.getLong("offset"))
    file.appendText(",\"bpm\":110}\n")
    val next = JSONObject(WorkoutJournal.page(ctx, "test-1", page.getLong("offset")))
    assertEquals(2, next.getJSONArray("samples").getJSONObject(0).getInt("seq"))
  }
  @Test fun acknowledgeRequiresTheCompletedRevision() {
    WorkoutJournal.save(ctx, meta("completed"))
    WorkoutJournal.acknowledge(ctx, "test-1", 0)
    assertEquals(1, org.json.JSONArray(WorkoutJournal.pending(ctx)).length())
    WorkoutJournal.acknowledge(ctx, "test-1", 1)
    assertEquals(0, org.json.JSONArray(WorkoutJournal.pending(ctx)).length())
    assertEquals("completed", WorkoutJournal.read(ctx, "test-1").getString("status"))
  }
  @Test fun pathTraversalIsRejected() {
    assertThrows(IllegalArgumentException::class.java) { WorkoutJournal.page(ctx, "../outside", 0) }
  }
  @Test fun readersOnlySeeFsyncedCheckpointData() {
    val line = "{\"seq\":1,\"bpm\":100}\n"
    WorkoutJournal.sampleFile(ctx, "test-1").writeText(line + "{\"seq\":2,\"bpm\":110}\n")
    WorkoutJournal.save(ctx, meta().put("committedOffset", line.length))
    val page = JSONObject(WorkoutJournal.page(ctx, "test-1", 0))
    assertEquals(1, page.getJSONArray("samples").length())
    assertFalse(page.getBoolean("more"))
  }
  @Test fun fullResetHasARecoverableMarkerAndRefusesAnActiveSession() {
    WorkoutJournal.save(ctx, meta())
    WorkoutJournal.setActive(ctx, "test-1")
    assertThrows(IllegalArgumentException::class.java) { WorkoutJournal.beginReset(ctx) }
    WorkoutJournal.save(ctx, meta("completed"))
    WorkoutJournal.setActive(ctx, null)
    WorkoutJournal.beginReset(ctx)
    assertTrue(WorkoutJournal.resetPending(ctx))
    // The Store is cleared between beginReset and finishReset; a new process can finish this sequence.
    WorkoutJournal.finishReset(ctx)
    assertFalse(WorkoutJournal.resetPending(ctx))
    assertEquals(0, org.json.JSONArray(WorkoutJournal.pending(ctx)).length())
  }
  @Test fun aCommittedStartIsRecoveredIfItsPointerWriteWasInterrupted() {
    WorkoutJournal.save(ctx, meta())
    assertEquals("test-1", WorkoutJournal.active(ctx)!!.getString("id"))
    assertEquals("interrupted", WorkoutJournal.active(ctx)!!.getString("status"))
  }
}
