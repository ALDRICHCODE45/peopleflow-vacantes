// Shared PeopleFlow accents: dark primary is a button fill, so icons/text lighten it.
const darkPrimaryText = "dark:text-[color-mix(in_oklch,var(--primary),white_45%)]";
export const accentTab = "data-active:text-primary dark:data-active:text-foreground after:bg-primary";
export const accentTabCount = `[[data-active]_&]:bg-primary/10 [[data-active]_&]:text-primary dark:[[data-active]_&]:bg-primary/30 dark:[[data-active]_&]:text-[color-mix(in_oklch,var(--primary),white_45%)]`;
export const accentAvatar = `bg-primary/10 text-primary dark:bg-primary/25 ${darkPrimaryText}`;
export const accentIcon = `text-primary ${darkPrimaryText}`;
export const accentIconTile = `bg-primary/10 text-primary dark:bg-primary/25 ${darkPrimaryText}`;
