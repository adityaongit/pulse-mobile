package app.pulse.workouts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.UUID

class PulseWorkoutsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PulseWorkouts")
    AsyncFunction("notificationsEnabled") {
      WorkoutNotification.enabled(requireNotNull(appContext.reactContext))
    }
    AsyncFunction("start") { config: String ->
      val ctx = requireNotNull(appContext.reactContext)
      val body = JSONObject(config).put("id", UUID.randomUUID().toString())
      WorkoutService.request(ctx, "start", body).get(20, java.util.concurrent.TimeUnit.SECONDS)
    }
    AsyncFunction("command") { id: String, action: String ->
      require(action in listOf("pause", "resume", "finish"))
      WorkoutService.request(requireNotNull(appContext.reactContext), action, JSONObject().put("id", id)).get(20, java.util.concurrent.TimeUnit.SECONDS)
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
