import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Card, CARD_CLASS, CardFill, useCardStyle } from "../Card";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { cardInfo } from "./cardInfo";
import { InfoButton, type InfoContent } from "./InfoButton";
import { ScrollAnchor } from "./ScreenScroll";

export type SectionShellProps = {
  variant: "section" | "card";
  title: string;
  info?: InfoContent | false;
  action?: { label: string; href: string } | ReactNode;
  aside?: ReactNode;
  /** Cards: a small icon before the title (Behavior insights' lightbulb). */
  icon?: ReactNode;
  /** A place a link can scroll to (`?section=<id>`, the web's `#id`): see <ScrollAnchor>. */
  id?: string;
  /** Makes the whole card one link. */
  href?: string;
  /** Card bodies flex so footers can align with mt-auto in stretched rows. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
};

const isLinkAction = (a: SectionShellProps["action"]): a is { label: string; href: string } => !!a && typeof a === "object" && "href" in a && "label" in a && !("props" in a);

const go = (href: string) => router.push(href as Href);

export function ActionLink({ label, href }: { label: string; href: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => go(href)} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} className="flex-row items-center gap-0.5 active:opacity-70">
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">{label}</Text>
      <Icon icon={ChevronRight} size={14} tone="foreground-secondary" strokeWidth={2} />
    </Pressable>
  );
}

/** The pressable card (a card that is one link): the card material, pressing in. */
export function CardLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const shadow = useCardStyle();
  return (
    <Pressable accessibilityRole="link" onPress={() => go(href)} className={cn(CARD_CLASS, "active:scale-[0.96]", className)} style={shadow}>
      <CardFill />
      {children}
    </Pressable>
  );
}

export function SectionShell({ id, ...props }: SectionShellProps) {
  const shell = <Shell {...props} />;
  return id ? <ScrollAnchor id={id}>{shell}</ScrollAnchor> : shell;
}

function Shell({ variant, title, info, action, aside, icon, href, fill, className, children }: SectionShellProps) {
  const actionNode = isLinkAction(action) ? <ActionLink {...action} /> : action;

  if (variant === "section") {
    return (
      <View className={cn("min-w-0", className)}>
        {/* Equal header heights keep neighbouring card bodies aligned. */}
        <View className="mb-3 min-h-[34px] flex-row items-center justify-between gap-3">
          <Text accessibilityRole="header" className="shrink text-[22px] font-semibold leading-7 tracking-[-0.01em]">
            {title}
          </Text>
          {(aside || actionNode) && (
            <View className="shrink-0 flex-row items-center gap-3">
              {typeof aside === "string" ? <Text className="text-xs font-medium leading-4 text-muted-foreground">{aside}</Text> : aside}
              {actionNode}
            </View>
          )}
        </View>
        {children}
      </View>
    );
  }

  const explanation = info === false ? undefined : (info ?? cardInfo(title));
  const header = (
    <View className="mb-3 min-h-6 flex-row items-center justify-between gap-2">
      <View className="shrink flex-row items-center gap-2">
        {icon && <View className="size-5 items-center justify-center">{icon}</View>}
        <Text accessibilityRole="header" className="shrink text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          {title}
        </Text>
      </View>
      <View className="shrink-0 flex-row items-center gap-2">
        {aside}
        {/* Pulled into the padding by the glyph's own inset, so the visible arrow sits on the 16 px edge and "Health Monitor" fits one line at 390 px. */}
        {href ? (
          <View className="-mr-2.5">
            <Icon icon={ChevronRight} size={18} tone="foreground-secondary" />
          </View>
        ) : (
          actionNode
        )}
        {explanation && <InfoButton info={explanation} label={title} variant="card" />}
      </View>
    </View>
  );

  if (href)
    return (
      <CardLink href={href} className={cn("min-w-0 p-4", fill && "flex-1", className)}>
        {header}
        {children}
      </CardLink>
    );

  return (
    <Card accessibilityLabel={title} className={cn("py-0", className)}>
      <View className={cn("min-w-0 p-4", fill && "flex-1")}>
        {header}
        {children}
      </View>
    </Card>
  );
}
