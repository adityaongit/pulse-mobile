// The Pace of Aging ruler's end labels: "Slow" with a turtle, "Fast" with a rabbit.
import { Rabbit, Turtle } from "lucide-react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";

/** As the web writes them: 15/22 secondary text, 16 px icons. */
export const SLOW = (
  <>
    <Icon icon={Turtle} size={16} tone="foreground-secondary" strokeWidth={1.75} />
    <Text className="text-[15px] leading-[22px] text-foreground-secondary">Slow</Text>
  </>
);
export const FAST = (
  <>
    <Text className="text-[15px] leading-[22px] text-foreground-secondary">Fast</Text>
    <Icon icon={Rabbit} size={16} tone="foreground-secondary" strokeWidth={1.75} />
  </>
);
