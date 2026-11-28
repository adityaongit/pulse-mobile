# Third-party code in pulse-air

No code or binary from the Google Health or Fitbit Android apps is included or loaded.

| What | Source | License |
|---|---|---|
| `android/src/main/jniLibs/arm64-v8a/libgg.so`, `libxp.so` | Built from [Google-Health-API/golden-gate](https://github.com/Google-Health-API/golden-gate) `b8a6f255` by fitbit-air's `tool/native/build.py`, unmodified, 16 KB page-aligned | Apache-2.0 (`licenses/golden-gate-*`) |
| Mbed TLS 2.28.10, statically linked into `libgg.so` | [Mbed-TLS/mbedtls](https://github.com/Mbed-TLS/mbedtls) | Apache-2.0 (`licenses/mbedtls-LICENSE.txt`) |
| lwIP, statically linked into `libgg.so` | [savannah lwip](https://savannah.nongnu.org/projects/lwip/) | BSD-3-Clause (`licenses/lwip-COPYING.txt`) |
| `android/src/main/java/com/fitbit/goldengate/bindings/**` | Golden Gate's Android bindings as adapted by [ThoreKoritzius/fitbit-air](https://github.com/ThoreKoritzius/fitbit-air) `f1e878ce` (per-stack TLS key resolver) | Apache-2.0 (SPDX headers kept) |
| `AirBattery.kt`'s session flow, channel hold, write queue and battery decoder | Ported from fitbit-air's `FitbitAirPlugin.kt`, `AirChannelActivity.kt`, `AirTxQueue.kt`, `AirBatteryDecoder.kt` | MIT (`licenses/fitbit-air-MIT.txt`) |
