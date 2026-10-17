import { useMemo, type ComponentProps } from "react";
import { Path as SkiaPath, Skia } from "@shopify/react-native-skia";

/**
 * Skia's Path for the charts. Skia throws on a path string it cannot parse, which closes the app, so the string is
 * parsed here once and a mark whose numbers went bad (a NaN from missing data) is skipped instead.
 */
export function Path({ path, ...p }: ComponentProps<typeof SkiaPath>) {
  const parsed = useMemo(() => (typeof path === "string" ? Skia.Path.MakeFromSVGString(path) : path), [path]);
  return parsed ? <SkiaPath {...p} path={parsed} /> : null;
}
