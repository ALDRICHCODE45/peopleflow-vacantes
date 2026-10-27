import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";

// Only attached to the public site root, never to the application layout.
export const editorial = Fraunces({ subsets: ["latin"], variable: "--font-site-editorial", display: "swap" });
export const modern = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-site-modern", display: "swap" });
