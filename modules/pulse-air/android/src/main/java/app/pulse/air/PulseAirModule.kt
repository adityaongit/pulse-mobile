package app.pulse.air

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The Fitbit Air's battery over its private Bluetooth channel (AirBattery.kt). */
class PulseAirModule : Module() {
  private var battery: AirBattery? = null

  private fun air(): AirBattery? = battery ?: appContext.reactContext?.applicationContext?.let { AirBattery(it).also { b -> battery = b } }

  override fun definition() = ModuleDefinition {
    Name("PulseAir")

    /** Whether a Fitbit Air is paired with this phone (false without the Nearby devices permission). */
    Function("hasAir") { air()?.bondedAir() != null }

    /** { percent, charging?, millivolts? }; rejects with a stable code (BUSY, AIR_NOT_FOUND, TIMEOUT, ...). */
    AsyncFunction("readBattery") { promise: Promise ->
      val air = air() ?: return@AsyncFunction promise.reject("UNAVAILABLE", "No Android context.", null)
      air.read { result ->
        result.fold({ promise.resolve(it) }, { e -> promise.reject((e as? AirError)?.code ?: "FAILED", e.message, null) })
      }
    }
  }
}
