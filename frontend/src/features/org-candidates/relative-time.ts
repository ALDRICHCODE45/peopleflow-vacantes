const relativeFormat = new Intl.RelativeTimeFormat("es-MX", { numeric: "always" });

/** Relative past time for activity and history lines; under a minute reads «hace un momento». */
export function relativeTime(value: string) {
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return "hace un momento";
  if (Math.abs(seconds) < 3600) return relativeFormat.format(Math.trunc(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return relativeFormat.format(Math.trunc(seconds / 3600), "hour");
  return relativeFormat.format(Math.trunc(seconds / 86400), "day");
}
