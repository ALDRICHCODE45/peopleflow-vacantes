import type { ReactNode } from "react";
import { FileText, type LucideIcon } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "cn";

type DocumentItemProps = {
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  /** Optional status badge (e.g. «CV corregido por tu empresa»); wraps with the description, no separator. */
  badge?: ReactNode;
  actions: ReactNode;
  /** v0 talent sheet document: muted surface, file-type media and downloads in its own footer. */
  presentation?: "default" | "panel";
  fileType?: "PDF" | "DOCX";
  footer?: ReactNode;
};

/** Official Item anatomy. The content keeps a 10rem basis (icon + name still fit one row at 390px) so, in a narrow card, the Item's native
 * flex-wrap moves the actions under the text instead of squeezing the description. */
export function DocumentItem({ icon: Icon = FileText, title, description, badge, actions, presentation = "default", fileType, footer }: DocumentItemProps) {
  const panel = presentation === "panel";
  return <Item variant={panel ? "muted" : "outline"} size="sm" className={cn(panel && "dark:border-border")}>
    {/* ItemMedia itself is the file tile; no nested document composition. */}
    <ItemMedia variant="icon" className={cn(panel && "min-h-12 min-w-10 flex-col gap-1 rounded-md border bg-card p-2")}><Icon aria-hidden="true" />{panel && fileType && <span className="text-[8px] text-muted-foreground">{fileType}</span>}</ItemMedia>
    <ItemContent className={cn("min-w-0", panel ? "basis-32" : "basis-40")}>
      <ItemTitle title={title} className={cn(panel && "line-clamp-none max-w-full break-words")}><span className={panel ? "break-all" : "truncate"}>{title}</span></ItemTitle>
      <ItemDescription className={cn("line-clamp-none flex gap-x-2 gap-y-1", panel ? "flex-col items-start text-xs" : "flex-wrap items-center")}>{description}{badge}</ItemDescription>
    </ItemContent>
    <ItemActions className="flex-wrap">{actions}</ItemActions>
    {footer && <ItemFooter className="flex-wrap border-t pt-2">{footer}</ItemFooter>}
  </Item>;
}
