package app.pulse.workouts

import android.Manifest
import android.annotation.SuppressLint
import android.app.*
import android.bluetooth.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/** One native owner for the GATT connection, monotonic clock and durable capture journal. */
@SuppressLint("MissingPermission")
class WorkoutService : Service() {
  companion object {
    @Volatile var runningId: String? = null
    @Volatile var snapshot: String? = null
    private val requests = ConcurrentHashMap<String, CompletableFuture<String>>()
    private const val NOTIFICATION = 3741
    private val SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    private val MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    fun request(ctx: Context, action: String, body: JSONObject): CompletableFuture<String> {
      if (action == "start" || action == "resume") require(WorkoutNotification.enabled(ctx)) { "notificationPermission" }
      val key = UUID.randomUUID().toString()
      val result = CompletableFuture<String>()
      requests[key] = result
      result.whenComplete { _, _ -> requests.remove(key) }
      try {
        val intent = Intent(ctx, WorkoutService::class.java).setAction(action)
          .putExtra("request", key).putExtra("body", body.toString())
        ctx.startForegroundService(intent)
      } catch (e: Exception) { result.completeExceptionally(e) }
      Handler(Looper.getMainLooper()).postDelayed({ result.completeExceptionally(java.util.concurrent.TimeoutException("commandTimeout")) }, 20_000)
      return result
    }
    fun active(ctx: Context): String? = snapshot ?: WorkoutJournal.active(ctx)?.toString()
  }

  private lateinit var worker: Handler
  private lateinit var thread: HandlerThread
  private var meta: JSONObject? = null
  private var log: RandomAccessFile? = null
  private var client: BluetoothGatt? = null
  private var runAt = 0L
  private var lastBeat = 0L
  private var checkpointAt = 0L
  private var attempts = 0
  private var epoch = 0
  private var generation = 0
  private var wake: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    thread = HandlerThread("PulseWorkout").apply { start() }
    worker = Handler(thread.looper)
    val channel = NotificationChannel(WorkoutNotification.CHANNEL, getString(R.string.pulse_workout_channel), NotificationManager.IMPORTANCE_LOW)
    channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val request = intent?.getStringExtra("request")
    try {
      val notification = notification()
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      else startForeground(NOTIFICATION, notification)
      worker.post {
        try {
          val body = JSONObject(intent?.getStringExtra("body") ?: "{}")
          command(intent?.action ?: "", body)
          request?.let { requests[it]?.complete(requireNotNull(meta).toString()) }
        } catch (e: Exception) {
          request?.let { requests[it]?.completeExceptionally(e) }
          if (meta == null) stopSelf()
        }
      }
    } catch (e: Exception) {
      request?.let { requests[it]?.completeExceptionally(e) }
      stopSelf()
    }
    // A killed process is recovered explicitly, with an interruption rather than invented samples.
    return START_NOT_STICKY
  }

  private fun command(action: String, body: JSONObject) {
    require(action in listOf("start", "pause", "resume", "finish")) { "invalidCommand" }
    if (action == "start") {
      require(!WorkoutJournal.resetPending(this)) { "resetPending" }
      require(WorkoutJournal.active(this) == null) { "activeWorkout" }
      val type = body.getString("type")
      require(type in listOf("walk", "run", "cycle", "strength", "hiit", "other")) { "invalidWorkout" }
      val address = body.getString("deviceId")
      require(BluetoothAdapter.checkBluetoothAddress(address)) { "invalidDevice" }
      val now = System.currentTimeMillis()
      meta = body.put("schemaVersion", 1).put("status", "recording").put("startedAt", now)
        .put("endedAt", JSONObject.NULL).put("updatedAt", now).put("activeMs", 0)
        .put("revision", 0).put("seq", 0).put("epoch", 0).put("link", "connecting")
        .put("lastBpm", JSONObject.NULL).put("lastSampleAt", JSONObject.NULL).put("error", JSONObject.NULL)
      runningId = body.getString("id")
      runAt = SystemClock.elapsedRealtime()
      openLog()
      checkpoint()
      WorkoutJournal.setActive(this, runningId)
      acquireWake()
      connect()
      updateNotification()
      worker.post(tick)
      return
    }
    val id = body.getString("id")
    if (meta == null) {
      meta = WorkoutJournal.read(this, id)
      epoch = requireNotNull(meta).optInt("epoch") + 1
      runningId = id
      openLog()
      worker.post(tick)
    }
    val m = requireNotNull(meta)
    require(m.getString("id") == id) { "sessionMismatch" }
    if (m.getString("status") == "completed") {
      require(action == "finish") { "completedSession" }
      stopSelf()
      return
    }
    updateTime()
    when (action) {
      "pause" -> {
        m.put("status", "paused").put("link", "off").put("lastBpm", JSONObject.NULL)
        runAt = 0
        disconnect()
        releaseWake()
      }
      "resume" -> {
        m.put("status", "recording").put("error", JSONObject.NULL)
        runAt = SystemClock.elapsedRealtime()
        attempts = 0
        acquireWake()
        connect()
      }
      "finish" -> {
        m.put("status", "completed").put("endedAt", System.currentTimeMillis()).put("link", "off")
        runAt = 0
        disconnect()
        releaseWake()
      }
    }
    checkpoint()
    if (action == "finish") {
      WorkoutJournal.setActive(this, null)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    } else updateNotification()
  }

  private fun openLog() {
    log?.close()
    log = RandomAccessFile(WorkoutJournal.sampleFile(this, requireNotNull(meta).getString("id")), "rw").apply {
      // A partial tail after process death is never treated as an accepted JSON record.
      var end = length()
      while (end > 0) { seek(end - 1); if (readByte().toInt() == 10) break; end-- }
      if (end != length()) setLength(end)
      if (end > 0) {
        var begin = end - 1
        while (begin > 0) { seek(begin - 1); if (readByte().toInt() == 10) break; begin-- }
        seek(begin)
        val last = JSONObject(readLine())
        meta?.let { m ->
          m.put("seq", maxOf(m.optLong("seq"), last.getLong("seq")))
          m.put("activeMs", maxOf(m.optLong("activeMs"), last.getLong("elapsedMs")))
          epoch = maxOf(epoch, last.getInt("epoch") + 1)
        }
      }
      seek(end)
    }
  }
  private fun updateTime() {
    val m = meta ?: return
    if (m.optString("status") == "recording" && runAt > 0) {
      val now = SystemClock.elapsedRealtime()
      m.put("activeMs", m.getLong("activeMs") + (now - runAt).coerceAtLeast(0))
      runAt = now
    }
  }
  private fun checkpoint() {
    val m = meta ?: return
    updateTime()
    log?.fd?.sync()
    m.put("updatedAt", System.currentTimeMillis()).put("epoch", epoch)
      .put("revision", m.optLong("revision") + 1).put("committedOffset", log?.filePointer ?: 0)
      .put("committedSeq", m.optLong("seq"))
    WorkoutJournal.save(this, m)
    publish()
    checkpointAt = SystemClock.elapsedRealtime()
  }
  private fun publish() {
    meta?.let { snapshot = JSONObject(it.toString()).put("seq", it.optLong("committedSeq")).toString() }
  }
  private val tick = object : Runnable {
    override fun run() {
      val m = meta ?: return
      if (m.optString("status") == "completed") return
      try {
        updateTime()
        if (m.optString("status") == "recording" && m.optString("link") == "live" &&
          SystemClock.elapsedRealtime() - lastBeat > 15_000) retry("sharingUnavailable")
        if (SystemClock.elapsedRealtime() - checkpointAt >= 5_000) { checkpoint(); updateNotification() }
        publish()
      } catch (_: Exception) { failStorage() }
      worker.postDelayed(this, 1_000)
    }
  }

  private fun connect() {
    disconnect()
    val m = meta ?: return
    if (m.optString("status") != "recording") return
    val gen = generation
    try {
      if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
        m.put("link", "lost").put("error", "bluetoothPermission"); return
      }
      attempts++
      val adapter = getSystemService(BluetoothManager::class.java)?.adapter
      if (adapter == null || !adapter.isEnabled) { retry("bluetoothOff"); return }
      m.put("link", "connecting").put("lastBpm", JSONObject.NULL)
      client = adapter.getRemoteDevice(m.getString("deviceId")).connectGatt(this, false, callbacks, BluetoothDevice.TRANSPORT_LE)
      worker.postDelayed({
        if (generation == gen && m.optString("link") != "live") retry("sharingUnavailable")
      }, 20_000)
    } catch (_: SecurityException) { m.put("link", "lost").put("error", "bluetoothPermission") }
    catch (_: Exception) { retry("connectionLost") }
  }
  private fun disconnect() {
    generation++
    epoch++
    val old = client
    client = null
    try { old?.disconnect(); old?.close() } catch (_: Exception) { /* already disconnected */ }
  }
  private fun retry(reason: String) {
    disconnect()
    val m = meta ?: return
    m.put("link", "lost").put("error", reason).put("lastBpm", JSONObject.NULL)
    if (m.optString("status") != "recording" || attempts >= 6) return
    val gen = generation
    worker.postDelayed({ if (generation == gen) connect() }, (2_000L shl attempts.coerceAtMost(4)).coerceAtMost(30_000))
  }
  private val callbacks = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      worker.post {
        if (gatt !== client) return@post
        if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
          try { if (!gatt.discoverServices()) retry("sharingUnavailable") } catch (_: SecurityException) { retry("bluetoothPermission") }
        } else retry("connectionLost")
      }
    }
    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      worker.post {
        if (gatt !== client) return@post
        try {
        val characteristic = gatt.getService(SERVICE)?.getCharacteristic(MEASUREMENT)
        val descriptor = characteristic?.getDescriptor(CCCD)
        if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null || descriptor == null ||
          !gatt.setCharacteristicNotification(characteristic, true)) { retry("sharingUnavailable"); return@post }
        if (Build.VERSION.SDK_INT >= 33) {
          if (gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) != BluetoothStatusCodes.SUCCESS) retry("sharingUnavailable")
        } else {
          @Suppress("DEPRECATION")
          descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          @Suppress("DEPRECATION")
          if (!gatt.writeDescriptor(descriptor)) retry("sharingUnavailable")
        }
        } catch (_: SecurityException) { retry("bluetoothPermission") }
      }
    }
    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      worker.post { if (gatt === client && status != BluetoothGatt.GATT_SUCCESS) retry("sharingUnavailable") }
    }
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid == MEASUREMENT) worker.post { if (gatt === client) sample(value) }
    }
    @Deprecated("Legacy Android callback")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      @Suppress("DEPRECATION") val bytes = characteristic.value?.clone() ?: return
      if (characteristic.uuid == MEASUREMENT) worker.post { if (gatt === client) sample(bytes) }
    }
  }
  private fun sample(bytes: ByteArray) {
    val m = meta ?: return
    if (m.optString("status") != "recording" || bytes.size < 2) return
    try {
      val flags = bytes[0].toInt() and 255
      val wide = flags and 1 != 0
      var index = if (wide) 3 else 2
      if (bytes.size < index) return
      val bpm = (bytes[1].toInt() and 255) + if (wide) ((bytes[2].toInt() and 255) shl 8) else 0
      val contact = (flags shr 1) and 3
      if (bpm !in 30..240 || contact == 2) { epoch++; m.put("lastBpm", JSONObject.NULL); return }
      if (flags and 8 != 0) index += 2
      val rr = JSONArray()
      if (flags and 16 != 0) while (index + 1 < bytes.size) {
        rr.put(((bytes[index].toInt() and 255) + ((bytes[index + 1].toInt() and 255) shl 8)) * 1000.0 / 1024)
        index += 2
      }
      updateTime()
      val seq = m.optLong("seq") + 1
      val now = System.currentTimeMillis()
      val row = JSONObject().put("seq", seq).put("t", now).put("elapsedMs", m.getLong("activeMs"))
        .put("bpm", bpm).put("epoch", epoch).put("rrMs", rr)
      log?.write((row.toString() + "\n").toByteArray(Charsets.UTF_8)) ?: error("storage")
      m.put("seq", seq).put("lastBpm", bpm).put("lastSampleAt", now).put("link", "live").put("error", JSONObject.NULL)
      lastBeat = SystemClock.elapsedRealtime()
      attempts = 0
      publish()
    } catch (_: Exception) { failStorage() }
  }
  private fun failStorage() {
    updateTime()
    meta?.put("status", "interrupted")?.put("error", "storage")?.put("link", "off")
    snapshot = meta?.toString()
    disconnect()
    releaseWake()
    try { checkpoint() } catch (_: Exception) { /* Keep last good journal; never reset it. */ }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
  private fun acquireWake() {
    if (wake?.isHeld == true) return
    wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Pulse:Workout").apply {
      setReferenceCounted(false)
      acquire(12 * 60 * 60 * 1000L)
    }
  }
  private fun releaseWake() { if (wake?.isHeld == true) wake?.release(); wake = null }
  private fun notification(): Notification = WorkoutNotification.build(this, meta)
  private fun updateNotification() { getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification()) }
  override fun onDestroy() {
    worker.removeCallbacksAndMessages(null)
    worker.post {
      try {
        if (meta?.optString("status") == "recording") {
          updateTime(); meta?.put("status", "interrupted")?.put("error", "interrupted"); checkpoint()
        }
      } catch (_: Exception) { /* Recovery keeps the last committed checkpoint. */ }
      disconnect()
      releaseWake()
      try { log?.close() } catch (_: Exception) { }
      runningId = null
      snapshot = null
      thread.quitSafely()
    }
    super.onDestroy()
  }
}
