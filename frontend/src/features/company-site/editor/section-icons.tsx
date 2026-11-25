import { BookOpen, Briefcase, ChartNoAxesColumn, Compass, Gift, HelpCircle, Images, MapPin, Megaphone, MessageSquareQuote, PanelTop, SlidersHorizontal, Video, type LucideIcon } from "lucide-react";
import type { BlockType } from "../model";

/** One distinct glyph per section type: the row tile, the library and the
 * collection empty states all read the same identity. Lucide is the editor's
 * icon library (components.json); Portada (top panel) and Cierre (call to
 * action) no longer share `LayoutTemplate`. */
export const SECTION_ICONS: Record<BlockType, LucideIcon> = {
  hero: PanelTop, story: BookOpen, values: Compass, benefits: Gift, stats: ChartNoAxesColumn, process: SlidersHorizontal,
  gallery: Images, testimonials: MessageSquareQuote, video: Video, offices: MapPin, jobs: Briefcase, faq: HelpCircle, closing: Megaphone,
};
