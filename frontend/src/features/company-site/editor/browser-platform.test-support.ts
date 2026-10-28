import { beforeAll, afterAll } from "vitest";

// jsdom has no Web Animations API; Base UI ScrollArea waits for viewport
// animations before measuring. Keep the real primitive, supplying only this API.
const original = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
beforeAll(() => { if (!original) Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] }); });
afterAll(() => {
  if (original) Object.defineProperty(Element.prototype, "getAnimations", original);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
});
