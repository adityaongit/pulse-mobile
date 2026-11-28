// Copied from ThoreKoritzius/fitbit-air (MIT, see modules/pulse-air/NOTICE.md).
package app.pulse.air

/**
 * Passive view of the shared tracker channel before our session starts.
 *
 * Every GATT client on the link receives the Air's tracker notifications.
 * Google Health's foreground polling is about 107 bytes per second; a sync is
 * a burst of large packets (thousands of bytes per second). Starting our
 * session during a sync makes that sync fail, so commands wait until the
 * channel is quiet, bounded by [maxHoldMillis] so alerts are never held
 * indefinitely. Only timing and sizes are recorded; payloads are encrypted.
 *
 * A silent channel starts after [quietStartMillis]: Google Health's syncs and
 * polling produce traffic well within that time. With a warm link the history
 * is already known, so [observeMillis] can be zero.
 */
internal class AirChannelActivity(
    private val observeMillis: Long = 700,
    private val quietWindowMillis: Long = 1_200,
    private val busyBytes: Int = 400,
    private val maxHoldMillis: Long = 10_000,
    private val quietStartMillis: Long = 300,
) {
    enum class Decision { WAIT, START }

    private val packets = ArrayDeque<Pair<Long, Int>>()
    private var startedAt: Long? = null
    var waited = false
        private set

    fun begin(nowMillis: Long) {
        startedAt = nowMillis
        packets.clear()
        waited = false
        observedPackets = 0
        observedBytes = 0
    }

    var observedPackets = 0
        private set
    var observedBytes = 0
        private set

    fun record(nowMillis: Long, size: Int) {
        observedPackets++
        observedBytes += size
        packets.addLast(nowMillis to size)
        trim(nowMillis)
    }

    fun busy(nowMillis: Long): Boolean {
        trim(nowMillis)
        return packets.sumOf { it.second } >= busyBytes
    }

    fun decide(nowMillis: Long): Decision {
        val start = checkNotNull(startedAt) { "Call begin() first." }
        val elapsed = nowMillis - start
        if (elapsed >= maxHoldMillis) return Decision.START
        if (observedPackets == 0 && elapsed >= minOf(quietStartMillis, observeMillis)) return Decision.START
        if (busy(nowMillis)) {
            waited = true
            return Decision.WAIT
        }
        return if (elapsed < observeMillis) Decision.WAIT else Decision.START
    }

    /** Fixed diagnostic label for the cleanup trace. */
    fun outcome(nowMillis: Long): String {
        val start = startedAt ?: return "none"
        return when {
            nowMillis - start >= maxHoldMillis && busy(nowMillis) -> "max"
            waited -> "waited"
            else -> "none"
        }
    }

    private fun trim(nowMillis: Long) {
        while (packets.isNotEmpty() && nowMillis - packets.first().first > quietWindowMillis) {
            packets.removeFirst()
        }
    }
}
