import { colorScheme, useColorScheme } from "nativewind";
import { useSyncExternalStore } from "react";
import { resolveCss } from "./color";
import { BLACK, PALETTES, type Palette, type Scheme } from "./palette";

// Pure black is the dark scheme with a #000 ground: NativeWind holds the scheme, this flag the ground. The root view
// takes the `pure-black` class while both are on (src/ui/providers.tsx).
let black = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Applies a theme choice (system, light, dark or black) to NativeWind's colour scheme and the pure-black ground. */
export function applyTheme(theme: string) {
  black = theme === "black";
  colorScheme.set(black ? "dark" : theme === "light" || theme === "dark" ? theme : "system");
  listeners.forEach((l) => l());
}

/** True while the pure black theme is on and the dark scheme is in force. */
export function usePureBlack(): boolean {
  const { colorScheme: scheme } = useColorScheme();
  return useSyncExternalStore(subscribe, () => black) && scheme === "dark";
}

/**
 * The active theme as concrete values, for what class names cannot reach (Skia, SVG, native chrome).
 * `c` is the palette of the scheme in force (NativeWind's colour scheme: the system's, or what the kit's toggle set),
 * with the #000 ground under pure black; `css` resolves a web colour string (`var(--x)`, color-mix) against it.
 */
export function useTheme(): { scheme: Scheme; c: Palette; css: (value: string) => string } {
  const { colorScheme } = useColorScheme();
  const scheme: Scheme = colorScheme === "dark" ? "dark" : "light";
  const c = usePureBlack() ? BLACK : PALETTES[scheme];
  return { scheme, c, css: (value) => resolveCss(value, c) };
}
