import type { ReactNode } from "react";
import { FileText, type LucideIcon } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

type DocumentItemProps = {
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  /** Optional status badge (e.g. «CV corregido por tu empresa»); wraps with the description, no separator. */
  badge?: ReactNode;
  actions: ReactNode;
};

/** Official Item anatomy. The content keeps a 10rem basis (icon + name still fit one row at 390px) so, in a narrow card, the Item's native
 * flex-wrap moves the actions under the text instead of squeezing the description. */
export function DocumentItem({ icon: Icon = FileText, title, description, badge, actions }: DocumentItemProps) {
  return <Item variant="outline" size="sm">
    <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
    <ItemContent className="min-w-0 basis-40">
      <ItemTitle title={title}><span className="truncate">{title}</span></ItemTitle>
      <ItemDescription className="line-clamp-none flex flex-wrap items-center gap-x-2 gap-y-1">{description}{badge}</ItemDescription>
    </ItemContent>
    <ItemActions className="flex-wrap">{actions}</ItemActions>
  </Item>;
}
