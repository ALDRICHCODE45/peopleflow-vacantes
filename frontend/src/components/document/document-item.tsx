import type { ReactNode } from "react";
import { FileText, type LucideIcon } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

type DocumentItemProps = {
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  actions: ReactNode;
};

/** Official Item anatomy; its native flex-wrap keeps document actions intrinsic. */
export function DocumentItem({ icon: Icon = FileText, title, description, actions }: DocumentItemProps) {
  return <Item variant="outline" size="sm">
    <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle title={title}><span className="truncate">{title}</span></ItemTitle>
      <ItemDescription className="line-clamp-none">{description}</ItemDescription>
    </ItemContent>
    <ItemActions className="flex-wrap">{actions}</ItemActions>
  </Item>;
}
