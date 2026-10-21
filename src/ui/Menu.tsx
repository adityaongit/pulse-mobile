import { i18n } from "@/i18n/config";
import { useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "./cn";
import { placeMenu, type Box } from "./menuPlace";
import { Panel } from "./Panel";

/** A dropdown's trigger: put `ref` on the trigger view (collapsable={false}); `open` measures it and shows the panel. */
export function useMenu() {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Box | null>(null);
  return {
    ref,
    anchor,
    // Page coordinates: from the top of the app's root view, which starts at the top of the screen (edge-to-edge), as the
    // translucent modal does. measureInWindow on Android sometimes leaves out the status bar and sometimes does not.
    open: () => ref.current?.measure((_x, _y, w, h, pageX, pageY) => setAnchor({ x: pageX, y: pageY, w, h })),
    close: () => setAnchor(null),
  };
}

/**
 * The web's dropdown panel (shadcn DropdownMenuContent with MENU_PANEL): rounded-2xl bg-popover p-1.5, a 1 px
 * foreground/10 ring and the overlay shadow, 8 px below the trigger and aligned to it (`start`, `end`, or `stretch` for
 * the trigger's width). Like Radix, it flips above only when it does not fit below and fits better above, and it never
 * covers its trigger. A tap outside closes it; there is no dim. It shows and goes at once, no fade: the modal's fade read
 * as lag, above all when a choice redraws every screen as it closes (Settings › App).
 *
 * The trigger and the modal's own root are both measured in page coordinates, and the panel is placed at the difference.
 */
export function MenuPanel({ anchor, onClose, align, className, children }: { anchor: Box | null; onClose: () => void; align: "start" | "end" | "stretch"; className?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const root = useRef<View>(null);
  const [frame, setFrame] = useState<Box | null>(null);
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null);

  const place = anchor && frame && panel ? placeMenu(anchor, frame, panel, insets, align) : null;

  return (
    <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable
        ref={root}
        collapsable={false}
        accessibilityLabel={i18n.t("ui:menu.close")}
        onPress={onClose}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          root.current?.measure((_x, _y, _w, _h, pageX, pageY) => setFrame({ x: pageX, y: pageY, w: width, h: height }));
        }}
        className="flex-1"
      >
        {anchor && (
          <Panel
            ringOutside
            // The panel swallows taps, so only outside it closes the menu.
            onStartShouldSetResponder={() => true}
            onLayout={(e) => setPanel({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            className={cn("absolute rounded-2xl p-1.5", className)}
            style={place ?? { left: 0, top: 0, width: align === "stretch" ? anchor.w : undefined, opacity: 0 }}
          >
            {children}
          </Panel>
        )}
      </Pressable>
    </Modal>
  );
}
