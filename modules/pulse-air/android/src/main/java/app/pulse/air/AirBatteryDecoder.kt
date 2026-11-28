// Copied from ThoreKoritzius/fitbit-air (MIT, see modules/pulse-air/NOTICE.md).
package app.pulse.air

/** Minimal protobuf reader for three int32 fields. Skips all identifiers. */
internal object AirBatteryDecoder {
    fun decode(bytes: ByteArray): Map<String, Int> {
        require(bytes.size <= 8192) { "Device-info response exceeds diagnostic limit." }
        var position = 0
        fun varint(): Long {
            var value = 0L
            for (index in 0..9) {
                require(position < bytes.size) { "Truncated device-info varint." }
                val next = bytes[position++].toInt() and 255
                require(index != 9 || next <= 1) { "Invalid device-info varint." }
                value = value or ((next and 127).toLong() shl (index * 7))
                if (next and 128 == 0) return value
            }
            error("Invalid device-info varint.")
        }
        fun skip(count: Long) {
            require(count >= 0 && count <= bytes.size - position) { "Truncated device-info field." }
            position += count.toInt()
        }
        val result = mutableMapOf<String, Int>()
        while (position < bytes.size) {
            val tag = varint()
            require(tag in 8..0xffffffffL) { "Invalid device-info field tag." }
            val field = (tag ushr 3).toInt()
            val name = when (field) {
                10 -> "rawOnCharger"
                12 -> "rawVoltage"
                13 -> "rawBatteryLevel"
                else -> null
            }
            val wire = (tag and 7).toInt()
            require(name == null || wire == 0) { "Unexpected battery field encoding." }
            when (wire) {
                0 -> {
                    val value = varint()
                    if (name != null) {
                        require(value in 0..Int.MAX_VALUE.toLong()) { "Invalid battery field value." }
                        result[name] = value.toInt()
                    }
                }
                1 -> skip(8)
                2 -> skip(varint())
                5 -> skip(4)
                else -> error("Unsupported device-info field encoding.")
            }
        }
        return result
    }
}
