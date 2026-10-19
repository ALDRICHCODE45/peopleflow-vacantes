import type { LocationRead, LocationValue } from "@/features/geo/model";
/** Geography fixtures shared only by draft tests. */
export const mexicoLocationRead: NonNullable<LocationRead> = { country: { id: "MX", name: "México" }, state: { id: "09", name: "Ciudad de México" }, municipality: null, postal_code: null, label: "Ciudad de México" };
export const mexicoLocationWrite = { country: "MX", state: "09" };
export const mexicoLocationValue: LocationValue = { country: "MX", state: "09", municipality: null, postal_code: null };
