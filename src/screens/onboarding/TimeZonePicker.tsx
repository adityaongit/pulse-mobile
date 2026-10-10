// A searchable time zone picker. Ported from pulse src/components/profile/TimeZoneCombobox.tsx: type a city, region or
// offset, or tap. The list opens in the flow under the field, so a sheet's scroll area never clips it. Differences
// forced by touch: there is no hover or arrow-key highlight (the row last pressed is the active one), and the list closes
// when a zone is picked or the chevron is tapped, not when the field loses focus (the press on a row would be lost).
import { useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, ScrollView, View, type TextInput } from "react-native";
import { Check, ChevronDown, Search } from "lucide-react-native";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { TextField } from "../settings/controls";
import { canonicalZone, describeZone, matchZones, zones, type Zone } from "./timeZones";

/** One option row, px (h-12); the list shows three. */
const ROW = 48;
const LIST = ROW * 3 + 8;

export function TimeZonePicker({ value, onChange, invalid, inputRef }: { value: string; onChange: (zone: string) => void; invalid?: boolean; inputRef?: RefObject<TextInput | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Where the unfiltered list opens: the row before the chosen zone, so it sits in the middle of the three shown.
  const [start, setStart] = useState(0);
  const own = useRef<TextInput>(null);
  const input = inputRef ?? own;

  const matches = useMemo(() => (open ? matchZones(query) : []), [open, query]);

  const show = (next: boolean) => {
    setOpen(next);
    setQuery("");
    if (next) {
      const at = Math.max(0, zones().findIndex((z) => z.id === canonicalZone(value)));
      setStart(at);
      setActive(at);
    }
  };
  const pick = (z: Zone) => {
    onChange(z.id);
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  return (
    <View className="gap-2">
      <TextField
        ref={input}
        accessibilityLabel="Time zone"
        accessibilityState={{ expanded: open }}
        invalid={invalid}
        autoCapitalize="none"
        spellCheck={false}
        placeholder={open || !value ? "Search city or GMT offset" : describeZone(value)}
        value={open ? query : value ? describeZone(value) : ""}
        onFocus={() => !open && show(true)}
        onChangeText={(t) => {
          setQuery(t);
          setActive(0);
          if (!open) setOpen(true);
        }}
        left={
          <View className="w-11 justify-center pl-4" pointerEvents="none">
            <Icon icon={Search} size={18} tone="muted-foreground" strokeWidth={1.75} />
          </View>
        }
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={open ? "Close time zones" : "Show time zones"} onPress={() => {
              haptic.tap();
              show(!open);
            }} className="h-13 w-12 items-center justify-center rounded-r-xl">
            <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
              <Icon icon={ChevronDown} size={20} tone="muted-foreground" strokeWidth={1.75} />
            </View>
          </Pressable>
        }
      />
      {open && (
        <View accessibilityLabel="Time zones" className="overflow-hidden rounded-xl bg-field p-1" style={{ height: matches.length ? Math.min(LIST, matches.length * ROW + 8) : undefined }}>
          {matches.length === 0 ? (
            <Text className="px-3 py-3 text-[15px] leading-5 text-muted-foreground">No time zone matches “{query}”.</Text>
          ) : (
            // A plain ScrollView, not a FlatList: a virtualized list may not nest inside the form's scroll view. About 420
            // rows at most, drawn only while the list is open. ponytail: move the list into its own sheet if opening it hitches.
            <ScrollView
              // A new search is a new list, from its first row.
              key={query}
              contentOffset={{ x: 0, y: (query ? 0 : Math.max(0, start - 1)) * ROW }}
              snapToInterval={ROW}
              decelerationRate="fast"
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {matches.map((z, i) => {
                const selected = z.id === canonicalZone(value);
                return (
                  <Pressable
                    key={z.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${z.city}, ${z.region}, ${z.offset}`}
                    onPressIn={() => setActive(i)}
                    onPress={() => pick(z)}
                    className={cn("h-12 flex-row items-center gap-3 rounded-lg px-3", i === active ? "bg-foreground/8" : "bg-transparent")}
                  >
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-5">
                      <Text className={cn("text-[15px] leading-5 text-foreground", selected ? "font-semibold" : "font-medium")}>{z.city}</Text>
                      <Text className="text-[15px] leading-5 text-muted-foreground"> · {z.region}</Text>
                    </Text>
                    <Text className="shrink-0 font-numeric text-[13px] leading-[18px] tabular-nums text-foreground-secondary">{z.offset}</Text>
                    <View style={{ opacity: selected ? 1 : 0 }}>
                      <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
