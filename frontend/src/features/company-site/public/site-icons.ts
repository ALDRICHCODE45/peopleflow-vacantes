import { Heart, Users, Rocket, Target, Lightbulb, Shield, Leaf, Globe, GraduationCap, Briefcase, Laptop, Clock, Calendar, Coffee, Dumbbell, Stethoscope, PiggyBank, Gift, Plane, House, Sparkles, Handshake, Trophy, Smile, type LucideIcon } from "lucide-react";
import type { ICONS } from "../model";

export const SITE_ICONS = {
  heart: Heart, users: Users, rocket: Rocket, target: Target, lightbulb: Lightbulb,
  shield: Shield, leaf: Leaf, globe: Globe, "graduation-cap": GraduationCap,
  briefcase: Briefcase, laptop: Laptop, clock: Clock, calendar: Calendar, coffee: Coffee,
  dumbbell: Dumbbell, stethoscope: Stethoscope, "piggy-bank": PiggyBank, gift: Gift,
  plane: Plane, home: House, sparkles: Sparkles, handshake: Handshake, trophy: Trophy, smile: Smile,
} satisfies Record<typeof ICONS[number], LucideIcon>;
