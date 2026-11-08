package app.pulse.workouts

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/** Private append-only sensor journal. SQLite is owned exclusively by src/data. */
object WorkoutJournal {
  private fun root(ctx: Context) = File(ctx.filesDir, "workout-journal").apply { mkdirs() }
  /** Only writers create a session folder; readers must not bring back one acknowledge pruned. */
  private fun dir(ctx: Context, id: String, create: Boolean = false): File {
    require(id.matches(Regex("[a-zA-Z0-9-]{1,80}"))) { "invalidSession" }
    return File(root(ctx), id).apply { if (create) mkdirs() }
  }
  private fun atomic(file: File, body: String) {
    val atomic = AtomicFile(file)
    var stream: FileOutputStream? = null
    try {
      stream = atomic.startWrite()
      stream.write(body.toByteArray(Charsets.UTF_8))
      atomic.finishWrite(stream)
    } catch (e: Exception) {
      if (stream != null) atomic.failWrite(stream)
      throw e
    }
  }
  @Synchronized fun save(ctx: Context, meta: JSONObject) {
    val folder = dir(ctx, meta.getString("id"), create = true)
    atomic(File(folder, "meta.json"), meta.toString())
    File(folder, "pending").let { if (!it.exists()) it.writeText("") }
  }
  @Synchronized fun read(ctx: Context, id: String): JSONObject =
    JSONObject(AtomicFile(File(dir(ctx, id), "meta.json")).openRead().bufferedReader().use { it.readText() })
  private fun exists(ctx: Context, id: String) = File(dir(ctx, id), "meta.json").exists()
  private fun pointer(ctx: Context) = File(root(ctx), "active")
  /** An empty pointer records "no session"; a missing one means unknown, and active() scans for an orphan. */
  @Synchronized fun setActive(ctx: Context, id: String?) {
    atomic(pointer(ctx), id ?: "")
  }
  /** Called before a start commits its first metadata, so a crash before setActive still finds the session. */
  @Synchronized fun forgetActive(ctx: Context) {
    AtomicFile(pointer(ctx)).delete()
  }
  @Synchronized fun active(ctx: Context): JSONObject? {
    val file = pointer(ctx)
    var id = if (file.exists()) AtomicFile(file).openRead().bufferedReader().use { it.readText() } else null
    if (id == null) {
      // Recover the tiny window between committing the first metadata and its active pointer.
      val orphan = root(ctx).listFiles()?.filter { it.isDirectory && File(it, "meta.json").exists() }
        ?.sortedByDescending { File(it, "meta.json").lastModified() }
        ?.firstOrNull { read(ctx, it.name).getString("status") != "completed" }
      // While a start is under way its metadata may not be committed yet; leave the pointer unknown for it.
      if (orphan == null) { if (WorkoutService.runningId == null) setActive(ctx, null); return null }
      id = orphan.name
      setActive(ctx, id)
    }
    if (id.isBlank()) return null
    if (!exists(ctx, id)) { setActive(ctx, null); return null }
    val meta = read(ctx, id)
    if (meta.getString("status") == "completed") { setActive(ctx, null); return null }
    if (meta.getString("status") == "recording" && WorkoutService.runningId != id) {
      // Never bridge a process-death gap with the last observed heart rate.
      meta.put("status", "interrupted").put("error", "interrupted")
      meta.put("revision", meta.getLong("revision") + 1)
      save(ctx, meta)
    }
    return meta
  }
  @Synchronized fun pending(ctx: Context): String {
    val result = JSONArray()
    root(ctx).listFiles()?.filter { it.isDirectory && File(it, "pending").exists() }?.take(20)?.forEach {
      result.put(read(ctx, it.name))
    }
    return result.toString()
  }
  /**
   * The Store holds this completed revision, samples included, so the journal is no longer needed and is deleted.
   * Idempotent: a second acknowledge of a pruned session is a no-op.
   */
  @Synchronized fun acknowledge(ctx: Context, id: String, revision: Long) {
    if (!exists(ctx, id)) return
    val meta = read(ctx, id)
    if (meta.getString("status") == "completed" && meta.getLong("revision") == revision) {
      check(dir(ctx, id).deleteRecursively()) { "storage" }
    }
  }
  /**
   * Finishes a session that no service is recording (interrupted, or left behind by process death) straight in the
   * journal, with no Bluetooth or foreground service. Starting a connectedDevice service needs Nearby devices on
   * Android 14+, so routing this through the service could leave the session unfinishable. The session keeps what the
   * last checkpoint committed; anything written after it is never read.
   */
  @Synchronized fun finishStopped(ctx: Context, id: String): String {
    require(WorkoutService.runningId != id) { "activeWorkout" }
    val meta = read(ctx, id)
    if (meta.getString("status") != "completed") {
      meta.put("status", "completed").put("link", "off").put("lastBpm", JSONObject.NULL)
        .put("endedAt", meta.optLong("updatedAt", System.currentTimeMillis()))
        .put("revision", meta.optLong("revision") + 1)
      save(ctx, meta)
    }
    setActive(ctx, null)
    return meta.toString()
  }
  private fun resetFile(ctx: Context) = File(ctx.filesDir, "workout-reset-pending")
  @Synchronized fun resetPending(ctx: Context) = resetFile(ctx).exists()
  @Synchronized fun beginReset(ctx: Context) {
    // A running service must be finished first; a session nothing records is deleted with the rest.
    require(WorkoutService.runningId == null) { "activeWorkout" }
    atomic(resetFile(ctx), "reset")
  }
  @Synchronized fun finishReset(ctx: Context) {
    check(root(ctx).deleteRecursively()) { "storage" }
    check(resetFile(ctx).delete() || !resetFile(ctx).exists()) { "storage" }
  }
  fun sampleFile(ctx: Context, id: String) = File(dir(ctx, id, create = true), "samples.jsonl")
  /** Byte cursor stops before an incomplete final line. Duplicate replay is safe in the Store. */
  @Synchronized fun page(ctx: Context, id: String, offset: Long): String {
    val result = JSONArray()
    val file = File(dir(ctx, id), "samples.jsonl")
    var next = offset
    var more = false
    if (file.exists()) RandomAccessFile(file, "r").use { input ->
      val committed = if (exists(ctx, id)) read(ctx, id).optLong("committedOffset", input.length()) else input.length()
      val end = minOf(committed, input.length())
      require(offset >= 0 && offset <= end) { "invalidCursor" }
      input.seek(offset)
      while (result.length() < 500 && input.filePointer < end) {
        val start = input.filePointer
        val line = input.readLine() ?: break
        if (input.filePointer == end) {
          input.seek(end - 1)
          if (input.readByte().toInt() != 10) { input.seek(start); break }
        }
        next = input.filePointer
        // A damaged line is skipped rather than failing every later page of the session.
        try { result.put(JSONObject(line)) } catch (_: org.json.JSONException) { }
      }
      more = next < end
    }
    return JSONObject().put("samples", result).put("offset", next).put("more", more).toString()
  }
}
