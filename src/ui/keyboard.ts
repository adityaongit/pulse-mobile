import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Keyboard, type LayoutChangeEvent, TextInput, type View } from "react-native";

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

/** Space kept between the focused field and the visible area's edge. */
const REVEAL_GAP = 16;

type Reveal = {
  scroll: RefObject<{ scrollTo(o: { y: number }): void } | null>;
  /** The view holding the scrolled children (`collapsable={false}`), placed `top` below the scroll content's top. */
  content: RefObject<View | null>;
  /** The scroll view's current offset. */
  offset: () => number;
  /** The scroll content's top padding: a shell pads its content under its floating header, which covers that much. */
  top: number;
};

/**
 * Brings the whole focused field into view while the keyboard is up, as a browser scrolls a focused input into view.
 * Android scrolls only far enough to show the caret, which leaves the rest of a multiline field, and whatever follows
 * it, under the keyboard. It runs when the keyboard shows, when the scroll view shrinks above it (the keyboard's inset
 * lands after the keyboard's event) and when the content grows (a multiline field gaining a line). Spread the result
 * on the scroll view.
 */
export function useRevealFocused({ scroll, content, offset, top }: Reveal) {
  const height = useRef(0);
  const reveal = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input || !content.current || !Keyboard.isVisible()) return;
    input.measureLayout(content.current, (_x, y, _w, h) => {
      const at = offset();
      const bottom = top + y + h + REVEAL_GAP;
      if (bottom > at + height.current) scroll.current?.scrollTo({ y: bottom - height.current });
      else if (y - REVEAL_GAP < at) scroll.current?.scrollTo({ y: Math.max(y - REVEAL_GAP, 0) });
    });
  }, [scroll, content, offset, top]);
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", reveal);
    return () => sub.remove();
  }, [reveal]);
  return {
    onLayout: (e: LayoutChangeEvent) => {
      height.current = e.nativeEvent.layout.height;
      reveal();
    },
    onContentSizeChange: reveal,
  };
}
