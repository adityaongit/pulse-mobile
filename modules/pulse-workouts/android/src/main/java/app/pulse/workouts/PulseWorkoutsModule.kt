package app.pulse.workouts

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture

class PulseWorkoutsModule : Module() {
  /**
   * Settles the JS promise when the service answers instead of parking a module thread on it; the request itself fails
   * with commandTimeout after 20 s. The message carries the code the recorder maps (workoutRecorder.ts `known`).
   */
  private fun settle(promise: Promise, run: () -> CompletableFuture<String>) {
    val fail = { e: Throwable -> (e.message ?: "commandFailed").let { promise.reject(it, it, e) } }
    try {
      run().whenComplete { value, error -> if (error != null) fail(error) else promise.resolve(value) }
    } catch (e: Exception) { fail(e) }
  }

  override fun definition() = ModuleDefinition {
    Name("PulseWorkouts")
    AsyncFunction("notificationsEnabled") {
      WorkoutNotification.enabled(requireNotNull(appContext.reactContext))
    }
    AsyncFunction("start") { config: String, promise: Promise ->
      settle(promise) {
        val body = JSONObject(config).put("id", UUID.randomUUID().toString())
        WorkoutService.request(requireNotNull(appContext.reactContext), "start", body)
      }
    }
    AsyncFunction("command") { id: String, action: String, promise: Promise ->
      settle(promise) {
        require(action in listOf("pause", "resume", "finish")) { "invalidCommand" }
        val ctx = requireNotNull(appContext.reactContext)
        if (action == "finish" && WorkoutService.runningId != id) CompletableFuture.completedFuture(WorkoutJournal.finishStopped(ctx, id))
        else WorkoutService.request(ctx, action, JSONObject().put("id", id))
      }
    }
    AsyncFunction("active") { WorkoutService.active(requireNotNull(appContext.reactContext)) }
    AsyncFunction("pending") { WorkoutJournal.pending(requireNotNull(appContext.reactContext)) }
    AsyncFunction("samples") { id: String, offset: Double ->
      WorkoutJournal.page(requireNotNull(appContext.reactContext), id, offset.toLong())
    }
    AsyncFunction("resetPending") { WorkoutJournal.resetPending(requireNotNull(appContext.reactContext)) }
    AsyncFunction("beginReset") { WorkoutJournal.beginReset(requireNotNull(appContext.reactContext)) }
    AsyncFunction("finishReset") { WorkoutJournal.finishReset(requireNotNull(appContext.reactContext)) }
    AsyncFunction("acknowledge") { id: String, revision: Double ->
      WorkoutJournal.acknowledge(requireNotNull(appContext.reactContext), id, revision.toLong())
    }
  }
}
