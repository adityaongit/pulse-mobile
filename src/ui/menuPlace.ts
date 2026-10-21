export type Box = { x: number; y: number; w: number; h: number };

/** The web's `sideOffset={8}`: the gap between the trigger and the panel. */
const GAP = 8;
/** How close the panel may come to the safe area's edges. */
const EDGE = 8;

/**
 * Where a dropdown panel goes, in the modal's coordinates: below the trigger unless it does not fit there and there is
 * more room above, aligned to the trigger's start or end (or its width for `stretch`), kept inside the screen. The
 * trigger and the modal's frame are both page readings, so their difference is the trigger in the modal. A panel taller
 * than the room on its side gets `maxHeight` (the room), and the caller scrolls its content.
 */
export function placeMenu(anchor: Box, frame: Box, panel: { w: number; h: number }, insets: { top: number; bottom: number }, align: "start" | "end" | "stretch") {
  const x = anchor.x - frame.x;
  const y = anchor.y - frame.y;
  const below = frame.h - insets.bottom - EDGE - (y + anchor.h + GAP);
  const above = y - GAP - (insets.top + EDGE);
  const down = panel.h <= below || below >= above;
  const maxHeight = Math.max(0, Math.min(panel.h, down ? below : above));
  const width = align === "stretch" ? anchor.w : panel.w;
  const left = align === "end" ? x + anchor.w - width : x;
  return {
    left: Math.max(EDGE, Math.min(left, frame.w - width - EDGE)),
    top: down ? y + anchor.h + GAP : y - GAP - maxHeight,
    maxHeight,
    width: align === "stretch" ? width : undefined,
  };
}
