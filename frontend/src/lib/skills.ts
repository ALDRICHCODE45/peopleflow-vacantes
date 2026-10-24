/**
 * Skills keep the casing the person typed («React, TypeScript»); empty entries are
 * dropped, inner whitespace collapses, and duplicates are detected without regard
 * to casing, keeping the first occurrence. Matches the backend rule.
 */
export function normalizeSkills(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const value of values) {
    const skill = value.trim().replace(/\s+/gu, " ");
    const key = skill.toLocaleLowerCase("es-MX");
    if (skill === "" || seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills;
}

/** Splits comma- or line-separated text into normalized skills. */
export function parseSkills(text: string): string[] {
  return normalizeSkills(text.split(/[,\n]/u));
}
