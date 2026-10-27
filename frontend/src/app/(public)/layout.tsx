import * as React from "react";

// Company sites own their header, main landmark and permanent PeopleFlow footer
// credit. Keep this group free of app chrome, including on route-state screens.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
