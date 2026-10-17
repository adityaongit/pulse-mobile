import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type View } from "react-native";

/**
 * How far the keyboard covers a view's bottom edge: padding of this much lifts the view's content clear of it. Measured
 * rather than assumed, since whether Android resizes the window for the keyboard depends on the phone (an edge-to-edge
 * window, the rule from Android 15, is not resized). The overlap is the view's bottom less the keyboard's top, measured
 * again when the keyboard comes or goes and when the view's own size changes: a window that does resize shrinks the
 * view above the keyboard, and the overlap falls to zero. Put `ref` and `onLayout` on a view that reaches the screen's
 * bottom and pad inside it, so the padding never changes the measured frame.
 */
export function useKeyboardInset() {
  const ref = useRef<View>(null);
  /** The keyboard's top in window coordinates, null while it is hidden. */
  const keyboardTop = useRef<number | null>(null);
  const [inset, setInset] = useState(0);
  const measure = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) return setInset(0);
    ref.current?.measureInWindow((_x, y, _w, height) => setInset(Math.max(0, y + height - top)));
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      measure();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTop.current = null;
      measure();
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measure]);
  return { ref, onLayout: measure, inset };
}
