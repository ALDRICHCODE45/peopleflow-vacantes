"use client";
import { useCallback, useEffect, useState } from "react";

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);

/** Every word of the query must appear in the text; accents and case are ignored. An empty query matches everything. */
export function matchesSearch(text: string, query: string): boolean {
  const words = fold(query);
  if (!words.length) return true;
  const haystack = fold(text).join(" ");
  return words.every(word => haystack.includes(word));
}

/** Client-side search over the loaded board, kept in `?q=` so a reload or a shared link keeps the view. Other parameters are preserved. */
export function useBoardSearch(): [string, (value: string) => void] {
  const [query, setQuery] = useState("");
  // Read after mount: the first render must match the server markup.
  useEffect(() => { setQuery(new URL(window.location.href).searchParams.get("q") ?? ""); }, []);
  const change = useCallback((value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value); else url.searchParams.delete("q");
    // `null` state, not `window.history.state`: Next's patched `replaceState` would otherwise skip syncing its router.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return [query, change];
}
