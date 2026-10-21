// The shell finds a card's info text by its English title; a translated title keeps the text and shows its own name.
import { cardInfo } from "@/ui/shells/cardInfo";

export const cardInfoFor = (id: string, title: string) => {
  const info = cardInfo(id);
  return info ? { ...info, title } : undefined;
};
