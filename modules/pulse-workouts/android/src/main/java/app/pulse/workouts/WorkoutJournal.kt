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
  private fun dir(ctx: Context, id: String): File {
    require(id.matches(Regex("[a-zA-Z0-9-]{1,80}"))) { "invalidSession" }
    return File(root(ctx), id).apply { mkdirs() }
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
    val folder = dir(ctx, meta.getString("id"))
    atomic(File(folder, "meta.json"), meta.toString())
    File(folder, "pending").let { if (!it.exists()) it.writeText("") }
  }
  @Synchronized fun read(ctx: Context, id: String): JSONObject =
    JSONObject(AtomicFile(File(dir(ctx, id), "meta.json")).openRead().bufferedReader().use { it.readText() })
  @Synchronized fun setActive(ctx: Context, id: String?) {
    atomic(File(root(ctx), "active"), id ?: "")
  }
  @Synchronized fun active(ctx: Context): JSONObject? {
    val file = File(root(ctx), "active")
    var id = if (file.exists()) AtomicFile(file).openRead().bufferedReader().use { it.readText() } else ""
    if (id.isBlank()) {
      // Recover the tiny window between committing the first metadata and its active pointer.
      val orphan = root(ctx).listFiles()?.filter { it.isDirectory && File(it, "meta.json").exists() }
        ?.sortedByDescending { File(it, "meta.json").lastModified() }
        ?.firstOrNull { read(ctx, it.name).getString("status") != "completed" }
      id = orphan?.name ?: return null
      setActive(ctx, id)
    }
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
  @Synchronized fun acknowledge(ctx: Context, id: String, revision: Long) {
    val meta = read(ctx, id)
    if (meta.getString("status") == "completed" && meta.getLong("revision") == revision) {
      check(File(dir(ctx, id), "pending").delete() || !File(dir(ctx, id), "pending").exists())
    }
  }
  private fun resetFile(ctx: Context) = File(ctx.filesDir, "workout-reset-pending")
  @Synchronized fun resetPending(ctx: Context) = resetFile(ctx).exists()
  @Synchronized fun beginReset(ctx: Context) {
    require(active(ctx) == null && WorkoutService.runningId == null) { "activeWorkout" }
    atomic(resetFile(ctx), "reset")
  }
  @Synchronized fun finishReset(ctx: Context) {
    check(root(ctx).deleteRecursively()) { "storage" }
    check(resetFile(ctx).delete() || !resetFile(ctx).exists()) { "storage" }
  }
  fun sampleFile(ctx: Context, id: String) = File(dir(ctx, id), "samples.jsonl")
  /** Byte cursor stops before an incomplete final line. Duplicate replay is safe in the Store. */
  @Synchronized fun page(ctx: Context, id: String, offset: Long): String {
    val result = JSONArray()
    val file = sampleFile(ctx, id)
    var next = offset
    var more = false
    if (file.exists()) RandomAccessFile(file, "r").use { input ->
      val metaFile = File(dir(ctx, id), "meta.json")
      val committed = if (metaFile.exists()) read(ctx, id).optLong("committedOffset", input.length()) else input.length()
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
        result.put(JSONObject(line))
      }
      more = next < end
    }
    return JSONObject().put("samples", result).put("offset", next).put("more", more).toString()
  }
}
