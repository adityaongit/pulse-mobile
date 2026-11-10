import { Image, View } from "react-native";
import { useTheme } from "./theme";

// Health Connect's official product icon (developer.android.com, Health Connect UI guidelines › Assets: 192 px PNG; no
// SVG is published), always in colour. The guidelines ask for a white or very light grey ground: on the dark ground it
// sits on a small white tile, where its navy half would otherwise disappear.
const ICON = require("../../assets/images/health-connect.png");

export function HealthConnectMark({ size = 20 }: { size?: number }) {
  const { scheme, c } = useTheme();
  const image = <Image source={ICON} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
  if (scheme !== "dark") return image;
  const pad = Math.round(size * 0.18);
  return <View style={{ padding: pad, borderRadius: Math.round(size * 0.3), backgroundColor: c["brand-tile"] }}>{image}</View>;
}
