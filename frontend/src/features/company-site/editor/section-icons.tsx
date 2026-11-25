import { Award, BookOpen, Briefcase, ChartNoAxesColumn, Compass, FileUp, Gift, HelpCircle, Images, LayoutGrid, MapPin, Megaphone, MessageSquareQuote, PanelTop, SlidersHorizontal, Users, Video, type LucideIcon } from "lucide-react";
import type { BlockTypeV2 } from "../model";

/** One distinct glyph per section type: the row tile, the library and the
 * collection empty states all read the same identity. Lucide is the editor's
 * icon library (components.json); Portada (top panel) and Cierre (call to
 * action) no longer share `LayoutTemplate`. */
export const SECTION_ICONS: Record<BlockTypeV2, LucideIcon> = {
  hero: PanelTop, story: BookOpen, values: Compass, benefits: Gift, stats: ChartNoAxesColumn, process: SlidersHorizontal,
  gallery: Images, testimonials: MessageSquareQuote, video: Video, offices: MapPin, jobs: Briefcase, faq: HelpCircle, closing: Megaphone,
  team: Users, logos: Award, areas: LayoutGrid, talent_cta: FileUp,
};
