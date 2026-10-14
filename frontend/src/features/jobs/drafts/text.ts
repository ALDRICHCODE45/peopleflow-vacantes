/**
 * Shared text normalization for the private vacancy draft slice
 * (`docs/contracts/private-vacancy-drafts-v1.md` §3).
 *
 * Extracted unchanged from `scalars.ts` so scalar and list rules share exactly
 * one Unicode White_Space policy instead of two copies. This module exports a
 * single string-in/string-out trim helper and applies no other policy: no NFC,
 * no case folding, no interior collapsing and no character-limit enforcement.
 */

/**
 * Exact Unicode `White_Space` set as code points. U+FEFF is deliberately absent
 * because it is not White_Space; zero-width characters are absent too, so both
 * are preserved. Written as numbers rather than a `\p{White_Space}` regex
 * escape so the repository's ES2017 TypeScript target stays unchanged.
 */
const UNICODE_WHITE_SPACE = new Set<number>([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
]);

function isWhiteSpaceCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && UNICODE_WHITE_SPACE.has(codePoint);
}

/**
 * Removes only Unicode White_Space code points from the ends, iterating by code
 * point so astral characters survive. Interior whitespace, combining sequences
 * and non-White_Space characters such as U+FEFF are never touched; no NFC or
 * case folding is applied. No lone-surrogate policy is invented.
 */
export function trimUnicodeWhiteSpace(value: string): string {
  const characters = [...value];
  let start = 0;
  let end = characters.length;
  while (start < end && isWhiteSpaceCharacter(characters[start])) start += 1;
  while (end > start && isWhiteSpaceCharacter(characters[end - 1])) end -= 1;
  return characters.slice(start, end).join("");
}
