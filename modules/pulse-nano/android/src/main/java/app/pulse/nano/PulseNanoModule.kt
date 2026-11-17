package app.pulse.nano

import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.Job
import java.util.concurrent.ConcurrentHashMap

class PulseNanoModule : Module() {
  private var model: GenerativeModel? = null
  private val jobs = ConcurrentHashMap<String, kotlinx.coroutines.Job>()
  private fun client(): GenerativeModel = model ?: Generation.getClient().also { model = it }

  override fun definition() = ModuleDefinition {
    Name("PulseNano")
    AsyncFunction("status") Coroutine { -> status() }
    AsyncFunction("prepare") Coroutine { ->
      val client = client()
      when (client.checkStatus()) {
        FeatureStatus.AVAILABLE -> status()
        FeatureStatus.DOWNLOADABLE -> {
          client.download().collect { }
          status()
        }
        FeatureStatus.DOWNLOADING -> mapOf("state" to "downloading", "model" to null)
        else -> mapOf("state" to "unavailable", "model" to null)
      }
    }
    AsyncFunction("generate") Coroutine { prompt: String, maxOutputTokens: Int, requestId: String ->
      if (client().checkStatus() != FeatureStatus.AVAILABLE) throw IllegalStateException("nano_unavailable")
      val job = currentCoroutineContext()[Job]
      if (job != null) jobs[requestId] = job
      try {
        withContext(Dispatchers.IO) {
          val response = client().generateContent(com.google.mlkit.genai.prompt.generateContentRequest(TextPart(prompt)) {
            this.maxOutputTokens = maxOutputTokens.coerceIn(16, 1024)
            temperature = 0.3f
          })
          response.candidates.firstOrNull()?.text ?: throw IllegalStateException("nano_empty_response")
        }
      } finally {
        if (job != null) jobs.remove(requestId, job)
      }
    }
    Function("cancel") { requestId: String -> jobs.remove(requestId)?.cancel() }
    OnDestroy { model?.close(); model = null; jobs.values.forEach { it.cancel() }; jobs.clear() }
  }

  private suspend fun status(): Map<String, String?> = withContext(Dispatchers.IO) {
    try {
      val client = client()
      val state = when (client.checkStatus()) {
        FeatureStatus.AVAILABLE -> "available"
        FeatureStatus.DOWNLOADABLE -> "downloadable"
        FeatureStatus.DOWNLOADING -> "downloading"
        else -> "unavailable"
      }
      mapOf("state" to state, "model" to if (state == "available") client.getBaseModelName() else null)
    } catch (_: Exception) {
      mapOf("state" to "unavailable", "model" to null)
    }
  }
}
