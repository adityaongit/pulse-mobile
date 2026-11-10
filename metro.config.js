const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

// Expo's default config with Sentry's serializer, which stamps the bundle and its source map with a shared Debug ID so
// crash stacks map back to source (docs/telemetry.md). It needs no Sentry credentials.
const config = getSentryExpoConfig(__dirname);

// babel.config.js imports lucide's createLucideIcon from its own file, which the package's "exports" does not list.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) =>
  (resolveRequest ?? context.resolveRequest)(name.startsWith("lucide-react-native/dist/") ? { ...context, unstable_enablePackageExports: false } : context, name, platform);

module.exports = withNativeWind(config, { input: "./global.css" });
