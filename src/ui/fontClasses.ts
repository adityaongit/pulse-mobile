import { LIGHT } from "./palette";

// The pure half of <Text> (Text.tsx): reading the web's font and colour classes off a class string. No React Native
// import, so it is unit-tested in Node (fontClasses.test.ts).

export type Family = "sans" | "numeric";
export type Weight = "regular" | "medium" | "semibold" | "bold";
export type Face = { family: Family; weight: Weight };

export const FACES: Record<Family, Record<Weight, string>> = {
  sans: { regular: "Manrope_400Regular", medium: "Manrope_500Medium", semibold: "Manrope_600SemiBold", bold: "Manrope_700Bold" },
  // Barlow is loaded from 500 up (as on the web), so its "regular" is the medium face.
  numeric: { regular: "Barlow_500Medium", medium: "Barlow_500Medium", semibold: "Barlow_600SemiBold", bold: "Barlow_700Bold" },
};
const WEIGHT_CLASS: Record<string, Weight> = { "font-normal": "regular", "font-medium": "medium", "font-semibold": "semibold", "font-bold": "bold" };
const FAMILY_CLASS: Record<string, Family> = { "font-sans": "sans", "font-numeric": "numeric" };

/**
 * The family and weight a class string asks for, the string without them, `truncate` / `line-clamp-N` as a line count,
 * and the flexShrink the text starts from (see `shrinkOf`).
 */
export function readFont(className: string | undefined, inherited: Face): { face: Face; rest: string; lines?: number; shrink?: number } {
  let { family, weight } = inherited;
  let lines: number | undefined;
  let nowrap = false;
  const rest: string[] = [];
  for (const token of (className ?? "").split(/\s+/).filter(Boolean)) {
    if (FAMILY_CLASS[token]) family = FAMILY_CLASS[token];
    else if (WEIGHT_CLASS[token]) weight = WEIGHT_CLASS[token];
    else if (token === "truncate") lines = 1;
    else if (/^line-clamp-\d+$/.test(token)) lines = Number(token.slice(11));
    else if (token === "whitespace-nowrap") nowrap = true;
    else rest.push(token);
  }
  return { face: { family, weight }, rest: rest.join(" "), lines, shrink: shrinkOf(rest, nowrap) };
}

/**
 * CSS flex items shrink by default (flex-shrink: 1) and their text wraps to fit; Yoga's do not (flexShrink 0), so a row
 * of bare text runs off its card on a narrow phone. Text therefore shrinks as on the web, unless its own classes set
 * flex or shrink (undefined: the class decides). `whitespace-nowrap` keeps its width, as the web's min-content width does.
 */
function shrinkOf(classes: string[], nowrap: boolean) {
  if (classes.some((c) => /^(?:[a-z-]+:)*(?:shrink|flex-)/.test(c))) return undefined;
  return nowrap ? 0 : 1;
}

// A class that sets the text colour: text-<token> (with an optional /opacity and variant prefixes), text-[#hex].
const COLOR_CLASS = new RegExp(
  `^(?:[a-z-]+:)*text-(?:${[...Object.keys(LIGHT), "transparent", "current"].join("|")})(?:/[\\d.\\[\\]]+)?$|^(?:[a-z-]+:)*text-\\[(?:#|rgb|hsl|color:|var\\()`,
);

/**
 * The web sets `text-foreground` on <body> and every element inherits it. React Native text inherits only from a parent
 * <Text>, so a top-level <Text> without a colour class of its own gets the foreground.
 */
export const hasColorClass = (className: string) => className.split(/\s+/).some((t) => COLOR_CLASS.test(t));
