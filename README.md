<div align="center">

<img src="assets/brand/logo-round.svg" alt="" width="88" height="88">

# Pulse Mobile

**Recovery, strain and sleep from your Fitbit, scored on your Android phone.**

No server, no account, no cloud: Pulse reads your Fitbit data from Health Connect and keeps every byte on the phone.

[![CI](https://github.com/adityaongit/pulse-mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/adityaongit/pulse-mobile/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/adityaongit/pulse-mobile?label=release)](https://github.com/adityaongit/pulse-mobile/releases/latest)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE)

</div>

## Download

<div align="center">

<a href="https://github.com/adityaongit/pulse-mobile/releases/latest"><img src="assets/badges/android.svg" alt="Available on Android" height="56"></a>

Grab `pulse-mobile-<version>-arm64.apk` from the [latest release](https://github.com/adityaongit/pulse-mobile/releases/latest). Sideloading asks you to allow
"Install unknown apps" for whichever app you download it with.

Want it on a server instead, for the browser and several people? See [Pulse](https://github.com/adityaongit/pulse).

</div>

## What you get

- **Sleep, Recovery and Strain** every morning, with a Strain Target for the day
- **Pulse Age**, **Stress** and **Energy Bank** through the day
- **Health Monitor**, **Journal**, **Trends**, **Reports** and **My Dashboard**

Every score is explained on the [metrics pages](https://pulse.portlabs.in/metrics/).

## How it works

```mermaid
flowchart LR
  F[Fitbit band] --> G[Google Health app]
  G --> HC[(Health Connect)]
  HC -->|read permissions| S[Import on the phone]
  S --> DB[(SQLite: expo-sqlite, async)]
  DB --> P[Pipeline: stage 1, stage 2, scoring v19]
  P --> DB
  DB --> Q[View models]
  Q --> UI[Screens: Expo Router, Skia charts]
```

On first open, allow every Health Connect permission, including past data: Pulse imports the last 180 days and only ever reads.

## Build from source

```sh
git clone https://github.com/adityaongit/pulse-mobile.git && cd pulse-mobile
pnpm install && pnpm android
```

Expo SDK 57 with a development build (Health Connect is a native module, so not Expo Go). [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md) have the rest; releases are in [docs/releases.md](docs/releases.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

<sub>Pulse Mobile is an independent project, not affiliated with or endorsed by Fitbit, Google, WHOOP, Bevel, Garmin or any other
wearable maker. The code names other products only to cite what they publish.</sub>
