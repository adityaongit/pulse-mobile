// Copied from ThoreKoritzius/fitbit-air (MIT, see modules/pulse-air/NOTICE.md).
package app.pulse.air

/**
 * Tracker-channel packets on their way to the Air, written one at a time.
 *
 * The outstanding write belongs to the connection it was started on:
 * - A replacement connection (a silent warm link falling back to a fresh
 *   one) never waits for a write on the old one, whose completion is ignored
 *   and would never arrive here.
 * - A new session on the same connection (a handshake retry) keeps waiting
 *   for the write Android is still processing, and its completion moves the
 *   queue on: [clear] drops packets only.
 *
 * Each accepted write gets exactly one completion, in order, so a completion
 * always belongs to the outstanding write. If a completion never arrives,
 * Android itself refuses further writes on that client as busy; nothing is
 * gained by writing past it, and the operation's timeout ends the command.
 */
internal class AirTxQueue {
    private val packets = ArrayDeque<ByteArray>()
    private var writingOn: Any? = null
    private var declinedInARow = 0

    @Synchronized fun add(packet: ByteArray) { packets.addLast(packet) }

    /** The next packet to write on [connection]; null while a write on it is outstanding or nothing waits. */
    @Synchronized fun next(connection: Any): ByteArray? {
        if (writingOn === connection) return null
        val packet = packets.removeFirstOrNull() ?: return null
        writingOn = connection
        return packet
    }

    /** The write on [connection] completed. False: it was not the outstanding one. */
    @Synchronized fun written(connection: Any): Boolean {
        if (writingOn !== connection) return false
        writingOn = null
        declinedInARow = 0
        return true
    }

    /**
     * Android declined to start writing [packet] on [connection]: it goes back
     * to the front. Returns whether to try again shortly; false after
     * [MAX_DECLINED_IN_A_ROW], when only the next packet or completion moves the queue on.
     */
    @Synchronized fun declined(connection: Any, packet: ByteArray): Boolean {
        if (writingOn === connection) writingOn = null
        packets.addFirst(packet)
        return ++declinedInARow <= MAX_DECLINED_IN_A_ROW
    }

    /** A new session on the same connection: its packets go, a write Android is processing stays outstanding. */
    @Synchronized fun clear() { packets.clear() }

    /** The connection is gone. */
    @Synchronized fun reset() {
        packets.clear()
        writingOn = null
        declinedInARow = 0
    }

    @get:Synchronized val size: Int get() = packets.size

    companion object {
        const val MAX_DECLINED_IN_A_ROW = 20
        /** Between attempts at a declined write: 20 × 25 ms bounds the retries to half a second. */
        const val DECLINED_RETRY_MILLIS = 25L
    }
}
