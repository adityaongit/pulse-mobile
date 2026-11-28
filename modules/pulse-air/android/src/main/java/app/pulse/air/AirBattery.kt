// Ported from ThoreKoritzius/fitbit-air's FitbitAirPlugin.kt (MIT, see modules/pulse-air/NOTICE.md): only the battery
// read, on a fresh connection each time (no warm link, no haptics, no diagnostics).
package app.pulse.air

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.fitbit.goldengate.bindings.GoldenGate
import com.fitbit.goldengate.bindings.coap.CoapEndpoint
import com.fitbit.goldengate.bindings.coap.data.Method
import com.fitbit.goldengate.bindings.coap.data.OutgoingRequestBuilder
import com.fitbit.goldengate.bindings.dtls.DtlsProtocolStatus.TlsProtocolState.TLS_STATE_ERROR
import com.fitbit.goldengate.bindings.dtls.DtlsProtocolStatus.TlsProtocolState.TLS_STATE_SESSION
import com.fitbit.goldengate.bindings.dtls.TlsKeyResolver
import com.fitbit.goldengate.bindings.io.RxSource
import com.fitbit.goldengate.bindings.io.TxSink
import com.fitbit.goldengate.bindings.node.BluetoothAddressNodeKey
import com.fitbit.goldengate.bindings.node.NodeKey
import com.fitbit.goldengate.bindings.stack.DtlsSocketNetifGattlink
import com.fitbit.goldengate.bindings.stack.Stack
import com.fitbit.goldengate.bindings.stack.StackEvent
import io.reactivex.disposables.CompositeDisposable
import java.util.UUID
import java.util.concurrent.TimeUnit

/** A failure with a stable code (the JS side reports the code to telemetry, never the message). */
class AirError(val code: String, message: String) : Exception(message)

/**
 * Reads the Fitbit Air's battery: connect to the bonded Air, subscribe to its tracker channel, wait for Google
 * Health's traffic to go quiet, open a Golden Gate DTLS session with the band's public bootstrap key, GET `/md/606`,
 * then hand the channel back to Google Health and disconnect. One read at a time; everything runs on the main looper.
 *
 * Any secure session leaves Google Health's Alarms and band settings unable to sync for about a minute (AirBuzz 0.9.11),
 * so callers read rarely (Pulse: at most once an hour).
 */
@SuppressLint("MissingPermission")
internal class AirBattery(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val disposables = CompositeDisposable()
  private val txQueue = AirTxQueue()

  private var done: ((Result<Map<String, Any>>) -> Unit)? = null
  private var gatt: BluetoothGatt? = null
  private var tx: BluetoothGattCharacteristic? = null
  private var txSink: TxSink? = null
  private var rxSource: RxSource? = null
  private var stack: Stack? = null
  private var endpoint: CoapEndpoint? = null
  private var channel: AirChannelActivity? = null
  private var sessionStarted = false
  private var handshakes = 0
  private var handshakeDeadline: Runnable? = null
  private var timeout: Runnable? = null
  private var handoff: Handoff? = null

  val busy get() = done != null

  fun bondedAir(): BluetoothDevice? {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return null
    return try {
      manager.adapter?.bondedDevices?.firstOrNull { it.name?.contains("Fitbit Air", ignoreCase = true) == true }
    } catch (_: SecurityException) {
      null
    }
  }

  fun read(callback: (Result<Map<String, Any>>) -> Unit) {
    handler.post { start(callback) }
  }

  private fun start(callback: (Result<Map<String, Any>>) -> Unit) {
    if (done != null) return callback(Result.failure(AirError("BUSY", "A battery read is already running.")))
    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    if (adapter?.isEnabled != true) return callback(Result.failure(AirError("BLUETOOTH_OFF", "Bluetooth is off.")))
    val device = bondedAir() ?: return callback(Result.failure(AirError("AIR_NOT_FOUND", "No paired Fitbit Air.")))
    done = callback
    sessionStarted = false
    handshakes = 0
    timeout = Runnable { fail("TIMEOUT", "The Fitbit Air did not answer in time.") }.also { handler.postDelayed(it, OPERATION_TIMEOUT_MS) }
    val connection = try {
      device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } catch (e: Exception) {
      null
    }
    if (connection == null) fail("GATT_CONNECT", "Android did not create a Bluetooth connection.") else gatt = connection
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = on(g) {
      when {
        status != BluetoothGatt.GATT_SUCCESS -> fail("GATT_CONNECT", "Bluetooth connection failed (status $status).")
        newState == BluetoothProfile.STATE_CONNECTED -> if (!g.discoverServices()) fail("GATT_DISCOVERY", "Service discovery did not start.")
        newState == BluetoothProfile.STATE_DISCONNECTED -> fail("GATT_DISCONNECTED", "The Fitbit Air disconnected.")
      }
    }

    @Suppress("DEPRECATION")
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = on(g) {
      val rx = g.getService(TRACKER_SERVICE)?.getCharacteristic(TRACKER_RX)
      val cccd = rx?.getDescriptor(CCCD)
      if (status != BluetoothGatt.GATT_SUCCESS || rx == null || cccd == null || !g.setCharacteristicNotification(rx, true)) {
        return@on fail("TRACKER_CHANNEL", "The tracker channel is unavailable.")
      }
      val accepted = if (Build.VERSION.SDK_INT >= 33) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
      } else {
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        g.writeDescriptor(cccd)
      }
      if (!accepted) fail("SUBSCRIBE", "Could not subscribe to the tracker channel.")
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = on(g) {
      if (descriptor.uuid != CCCD) return@on
      if (status != BluetoothGatt.GATT_SUCCESS) fail("SUBSCRIBE", "Tracker subscription failed (status $status).") else holdWhileBusy(g)
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) = on(g) { received(c, value) }

    @Deprecated("Below API 33")
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      val value = c.value?.copyOf() ?: return
      on(g) { received(c, value) }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) = on(g) {
      if (!txQueue.written(g)) return@on
      if (status != BluetoothGatt.GATT_SUCCESS) fail("TX", "Tracker write failed (status $status).") else writeNext(g)
    }
  }

  /** Runs [action] on the main looper if [g] is still this read's connection (a closed one's callbacks are dropped). */
  private fun on(g: BluetoothGatt, action: () -> Unit) {
    handler.post { if (g === gatt) action() }
  }

  private fun received(c: BluetoothGattCharacteristic, value: ByteArray) {
    if (c.uuid != TRACKER_RX) return
    channel?.record(SystemClock.elapsedRealtime(), value.size)
    rxSource?.receiveData(value)?.subscribe({}, { fail("RX", "Receive failed.") })
  }

  /** Starting a session during a Google Health sync makes that sync fail: wait (up to 10 s) for a quiet channel. */
  private fun holdWhileBusy(g: BluetoothGatt) {
    val activity = AirChannelActivity().also { it.begin(SystemClock.elapsedRealtime()) }
    channel = activity
    handler.postDelayed(object : Runnable {
      override fun run() {
        if (channel !== activity || g !== gatt) return
        if (activity.decide(SystemClock.elapsedRealtime()) == AirChannelActivity.Decision.WAIT) {
          handler.postDelayed(this, HOLD_TICK_MS)
        } else {
          channel = null
          startSession(g)
        }
      }
    }, HOLD_TICK_MS)
  }

  private fun startSession(g: BluetoothGatt) {
    try {
      val service = g.getService(TRACKER_SERVICE)
      tx = service?.getCharacteristic(TRACKER_TX) ?: return fail("TRACKER_CHANNEL", "The tracker channel is missing.")
      loadNative()
      val coap = CoapEndpoint()
      // null: Stack's default resolvers (HELLO, then the band's public BOOTSTRAP key).
      val newStack = openStack(g, null) { false }
      endpoint = coap
      coap.attach(newStack)
      disposables.add(newStack.dtlsEventObservable.subscribe({ state ->
        handler.post {
          if (endpoint !== coap || sessionStarted) return@post
          if (state.state == TLS_STATE_ERROR && state.lastError == LOST_HANDSHAKE_RACE) {
            // Google Health answered the Air's handshake too and both stall: retry soon.
            handshakeDeadline?.let(handler::removeCallbacks)
            handshakeDeadline = Runnable { retryHandshake(g) }.also { handler.postDelayed(it, LOST_RACE_RETRY_MS) }
          } else if (state.state == TLS_STATE_SESSION) {
            sessionStarted = true
            handshakeDeadline?.let(handler::removeCallbacks)
            handshakeDeadline = null
            g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
            requestBattery(coap)
          }
        }
      }, { handler.post { if (endpoint === coap) fail("DTLS", "Secure transport failed.") } }))
      handshakes++
      handshakeDeadline = Runnable { if (endpoint === coap && !sessionStarted) retryHandshake(g) }.also { handler.postDelayed(it, HANDSHAKE_RETRY_MS) }
      newStack.start()
    } catch (e: UnsatisfiedLinkError) {
      fail("NATIVE_UNAVAILABLE", "No Golden Gate library for this phone's CPU.")
    } catch (e: Throwable) {
      fail("GOLDENGATE", "Could not start the secure session.")
    }
  }

  /**
   * A Golden Gate stack over the tracker channel; packets are dropped while [muted]. Checked on the native loop thread
   * too, so nothing queued after the Air's reset reaches the tracker. Call on the main looper.
   */
  private fun openStack(g: BluetoothGatt, resolver: TlsKeyResolver?, muted: () -> Boolean): Stack {
    val sink = TxSink().also { txSink = it }
    val source = RxSource().also { rxSource = it }
    disposables.add(sink.dataObservable.subscribe({ data ->
      if (muted()) return@subscribe
      handler.post {
        if (txSink !== sink || g !== gatt || muted()) return@post
        txQueue.add(data)
        writeNext(g)
      }
    }, { handler.post { if (txSink === sink) fail("GOLDENGATE_TX", "Transport send failed.") } }))
    val key = BluetoothAddressNodeKey(g.device.address)
    return (if (resolver == null) Stack(key, sink.thisPointer, source.thisPointer, DtlsSocketNetifGattlink(), false)
    else Stack(key, sink.thisPointer, source.thisPointer, DtlsSocketNetifGattlink(), false, resolver)).also { stack = it }
  }

  /** A handshake normally completes within ~2 s; a stalled one gets one fresh attempt (no command was sent yet). */
  private fun retryHandshake(g: BluetoothGatt) {
    handshakeDeadline = null
    if (handshakes >= MAX_HANDSHAKES) return fail("HANDSHAKE_TIMEOUT", "Google Health may be using the Fitbit Air.")
    disposeSession()
    startSession(g)
  }

  private fun requestBattery(coap: CoapEndpoint) {
    val request = OutgoingRequestBuilder("/md/606", Method.GET).expectSuccess(false).forceNonBlockwise(true).maxResendCount(0).build()
    disposables.add(coap.responseFor(request).timeout(5, TimeUnit.SECONDS).flatMap { response ->
      response.body.asData().map { bytes ->
        if (response.responseCode.responseClass.toInt() != 2) throw AirError("BATTERY_REJECTED", "The Fitbit Air refused the battery read.")
        val fields = AirBatteryDecoder.decode(bytes)
        val level = fields["rawBatteryLevel"]
        if (level == null || level !in 0..100) throw AirError("BATTERY_INVALID", "No valid battery level.")
        buildMap<String, Any> {
          put("percent", level)
          fields["rawOnCharger"]?.let { put("charging", it != 0) }
          fields["rawVoltage"]?.let { put("millivolts", it) }
        }
      }
    }.subscribe({ value -> handler.post { if (endpoint === coap) finish(Result.success(value)) } }, { e ->
      handler.post { if (endpoint === coap) fail((e as? AirError)?.code ?: "BATTERY_READ_FAILED", "Could not read the battery.") }
    }))
  }

  @Suppress("DEPRECATION")
  private fun writeNext(g: BluetoothGatt) {
    val characteristic = tx ?: return
    val packet = txQueue.next(g) ?: return
    val status = if (Build.VERSION.SDK_INT >= 33) {
      g.writeCharacteristic(characteristic, packet, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
    } else {
      characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      characteristic.value = packet
      if (g.writeCharacteristic(characteristic)) BluetoothGatt.GATT_SUCCESS else -1
    }
    if (status == BluetoothGatt.GATT_SUCCESS) return
    // Busy (or unknown below API 33): try again shortly, bounded. Any other refusal won't pass on retry.
    val retry = txQueue.declined(g, packet)
    if (status != -1 && status != WRITE_BUSY) return fail("TX", "Android rejected the tracker write (status $status).")
    if (retry) handler.postDelayed({ if (gatt === g) writeNext(g) }, AirTxQueue.DECLINED_RETRY_MILLIS)
  }

  private fun fail(code: String, message: String) = finish(Result.failure(AirError(code, message)))

  /** Hands the channel back to Google Health (unless the link itself is gone), then closes and reports. */
  private fun finish(result: Result<Map<String, Any>>) {
    val callback = done ?: return
    val g = gatt
    val linkGone = (result.exceptionOrNull() as? AirError)?.code?.startsWith("GATT_") == true
    handoff?.let { return complete(it) }
    if (g == null || stack == null || tx == null || linkGone) {
      close()
      done = null
      return callback(result)
    }
    handOff(g) {
      done = null
      callback(result)
    }
  }

  /**
   * Our session leaves Google Health's Gattlink out of sync, and it would only recover through its ~60 s watchdog. A
   * stack that refuses every key makes the Air reset the link for every client; Google Health obeys that reset, so we
   * go silent at that point and let it complete the handshake alone.
   */
  private fun handOff(g: BluetoothGatt, then: () -> Unit) {
    val pending = Handoff(then)
    handoff = pending
    timeout?.let(handler::removeCallbacks)
    timeout = null
    pending.deadline = Runnable { complete(pending) }.also { handler.postDelayed(it, HANDOFF_TIMEOUT_MS) }
    try {
      disposeSession()
      val kick = openStack(g, RefusingTlsKeyResolver) { pending.muted }
      disposables.add(kick.stackEventObservable.subscribe({ event ->
        if (event is StackEvent.GattlinkSessionResent) {
          pending.muted = true
          handler.post { complete(pending) }
        }
      }, {}))
      kick.start()
    } catch (e: Throwable) {
      complete(pending)
    }
  }

  private fun complete(pending: Handoff) {
    if (handoff !== pending) return
    pending.muted = true
    pending.deadline?.let(handler::removeCallbacks)
    handoff = null
    close()
    pending.then()
  }

  /** Releases the native session but keeps the connection. */
  private fun disposeSession() {
    disposables.clear()
    endpoint?.close(); endpoint = null
    stack?.close(); stack = null
    rxSource?.close(); rxSource = null
    txSink?.close(); txSink = null
    txQueue.clear()
  }

  private fun close() {
    timeout?.let(handler::removeCallbacks); timeout = null
    handshakeDeadline?.let(handler::removeCallbacks); handshakeDeadline = null
    channel = null
    runCatching { disposeSession() }
    tx = null
    txQueue.reset()
    val g = gatt
    gatt = null
    g?.let {
      runCatching { it.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_LOW_POWER) }
      runCatching { it.disconnect() }
      runCatching { it.close() }
    }
  }

  private class Handoff(val then: () -> Unit) {
    @Volatile var muted = false
    var deadline: Runnable? = null
  }

  /** Refuses every identity, so the Air's next handshake fails and it resets the link. */
  private object RefusingTlsKeyResolver : TlsKeyResolver() {
    override fun resolveKey(nodeKey: NodeKey<*>, keyId: ByteArray): ByteArray? = null
  }

  companion object {
    @Volatile private var nativeLoaded = false

    /** libxp.so links against libgg.so: load the core first. */
    @Synchronized private fun loadNative() {
      if (nativeLoaded) return
      System.loadLibrary("gg")
      GoldenGate.init(loggingEnabled = false)
      nativeLoaded = true
    }

    /** BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY (API 33). */
    private const val WRITE_BUSY = 201
    private const val OPERATION_TIMEOUT_MS = 45_000L
    private const val HANDOFF_TIMEOUT_MS = 10_000L
    private const val HANDSHAKE_RETRY_MS = 6_000L
    private const val LOST_RACE_RETRY_MS = 1_500L
    private const val HOLD_TICK_MS = 100L
    /** DTLS error seen when Google Health answered the same handshake. */
    private const val LOST_HANDSHAKE_RACE = -1
    private const val MAX_HANDSHAKES = 2
    private val TRACKER_SERVICE = UUID.fromString("abbaff00-e56a-484c-b832-8b17cf6cbfe8")
    private val TRACKER_TX = UUID.fromString("abbaff01-e56a-484c-b832-8b17cf6cbfe8")
    private val TRACKER_RX = UUID.fromString("abbaff02-e56a-484c-b832-8b17cf6cbfe8")
    private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  }
}
