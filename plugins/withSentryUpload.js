// Source-map upload for release builds (docs/telemetry.md). @sentry/react-native's Expo plugin applies its sentry.gradle,
// whose upload task runs sentry-cli on every release variant and fails the build when the upload fails, as it does
// without a token. So the plugin is applied only when the build has SENTRY_AUTH_TOKEN; the org and the project come
// from SENTRY_ORG and SENTRY_PROJECT. Without the token the app builds as before and crash reports still arrive, with
// minified stacks. Error reporting itself needs only EXPO_PUBLIC_SENTRY_DSN (src/lib/telemetry.ts).
const { withSentry } = require("@sentry/react-native/expo");

module.exports = (config) =>
  process.env.SENTRY_AUTH_TOKEN ? withSentry(config, { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }) : config;
