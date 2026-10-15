/**
 * Canonical `go-json-v1` byte encoder for the restricted validated-value view
 * (`docs/contracts/private-vacancy-drafts-canonical-json-v1.md`).
 *
 * Scope: this module only turns an already validated and normalized value into
 * canonical bytes. It does not decode raw JSON, does not validate a rich draft
 * grammar, does not apply the rich/plain byte budgets and does not compute a
 * DTO fingerprint. Callers must hand in a value that already passed domain
 * validation and normalization; the encoder only re-checks the mechanical
 * preconditions it needs to stay total.
 *
 * Accepted values: `null`, boolean, well-formed-Unicode string, safe-integer
 * `number`, signed-int64 `bigint`, dense ordinary arrays and plain data objects
 * (ordinary or null prototype) with ASCII keys. Everything else is rejected,
 * including unsafe/fractional/non-finite numbers, out-of-range bigints,
 * unpaired surrogates, non-ASCII keys, class instances, Array subclasses and
 * custom-prototype arrays, sparse arrays, accessor/non-enumerable/symbol
 * properties, `undefined`, functions, symbols and objects exposing `toJSON`.
 * Object hooks are never invoked: property values are read from own property
 * descriptors, never through `toJSON`, a getter or a custom marshaler.
 *
 * Byte format: plain `JSON.stringify`-free serialization that mirrors default
 * `encoding/json.Marshal` (HTML escaping enabled), with raw object keys sorted
 * lexicographically before escaping and no trailing newline. Two internal
 * defensive guards bound the work: inclusive depth 128 (root value depth 1)
 * and inclusive 131072 reserved JSON value occurrences (map keys excluded,
 * repeated references counted per occurrence). Cycles terminate through those
 * guards. These are technical encoder limits, not rich-grammar depth/node
 * limits and not HTTP body limits.
 *
 * Traversal uses a container-cursor stack: at most one cursor frame per open
 * level, so the pending-frame memory is O(depth) and never O(children). Children
 * are reserved in the occurrence budget before descent and consumed one at a
 * time. Only the transient own-key list needed to count/validate a container's
 * children can reach O(children); it is never retained as a work frame.
 */

/** Inclusive technical nesting depth; the root value is depth 1. */
export const GO_JSON_V1_MAX_DEPTH = 128;
/** Inclusive technical number of reserved JSON value occurrences; keys excluded. */
export const GO_JSON_V1_MAX_VALUES = 131072;

const INT64_MIN = BigInt("-9223372036854775808");
const INT64_MAX = BigInt("9223372036854775807");
const GO_JSON_HEX = "0123456789abcdef";

/** Named rejection codes mirrored from the backend `draftjson` package. */
export type GoJsonV1ErrorCode =
  | "ErrUnsupportedType"
  | "ErrInvalidUTF8"
  | "ErrNonASCIIKey"
  | "ErrInt64Range"
  | "ErrDepthLimit"
  | "ErrValueLimit";

/** Raised for any value outside the restricted validated-value view. */
export class GoJsonV1EncodeError extends Error {
  readonly code: GoJsonV1ErrorCode;

  constructor(code: GoJsonV1ErrorCode, message: string) {
    super(message);
    this.name = "GoJsonV1EncodeError";
    this.code = code;
  }
}

const isAscii = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
};

/** A well-formed string has no unpaired UTF-16 surrogate code unit. */
const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

/**
 * Escape one string exactly like default `encoding/json.Marshal` with HTML
 * escaping enabled: `"` `\` and C0 controls are escaped, `<` `>` `&` become
 * `\u003c` `\u003e` `\u0026`, U+2028/U+2029 become `\u2028`/`\u2029`, and
 * every other code point stays literal (`\b`/`\f`/`\n`/`\r`/`\t` short forms
 * included, ASCII DEL left literal). No Unicode normalization is applied.
 */
const escapeGoJsonString = (value: string): string => {
  let result = '"';
  for (const character of value) {
    switch (character) {
      case '"':
        result += '\\"';
        continue;
      case "\\":
        result += "\\\\";
        continue;
      case "\b":
        result += "\\b";
        continue;
      case "\f":
        result += "\\f";
        continue;
      case "\n":
        result += "\\n";
        continue;
      case "\r":
        result += "\\r";
        continue;
      case "\t":
        result += "\\t";
        continue;
      default:
        break;
    }
    const codePoint = character.codePointAt(0) as number;
    if (codePoint < 0x20) {
      result += `\\u00${GO_JSON_HEX[(codePoint >> 4) & 0xf]}${GO_JSON_HEX[codePoint & 0xf]}`;
      continue;
    }
    switch (codePoint) {
      case 0x26:
        result += "\\u0026";
        continue;
      case 0x3c:
        result += "\\u003c";
        continue;
      case 0x3e:
        result += "\\u003e";
        continue;
      case 0x2028:
        result += "\\u2028";
        continue;
      case 0x2029:
        result += "\\u2029";
        continue;
      default:
        result += character;
    }
  }
  return `${result}"`;
};

/**
 * Enforce both technical limits for one container before its children are
 * reserved. The depth guard runs first so an already-too-deep container is
 * rejected without enumerating a potentially huge child set. `scheduled` is
 * the count of already-reserved-but-unvisited occurrences, so `visited +
 * scheduled + children` is the total claim after reservation.
 */
const guardContainer = (visited: number, scheduled: number, children: number, depth: number): void => {
  if (children === 0) return;
  if (depth + 1 > GO_JSON_V1_MAX_DEPTH) {
    throw new GoJsonV1EncodeError(
      "ErrDepthLimit",
      `go-json-v1: child depth ${depth + 1} exceeds ${GO_JSON_V1_MAX_DEPTH}`,
    );
  }
  const claimed = visited + scheduled + children;
  if (claimed > GO_JSON_V1_MAX_VALUES) {
    throw new GoJsonV1EncodeError(
      "ErrValueLimit",
      `go-json-v1: ${claimed} pending value occurrences exceed ${GO_JSON_V1_MAX_VALUES}`,
    );
  }
};

/**
 * One open container being iterated depth-first. Exactly one cursor exists per
 * open level, so the stack is bounded by the depth limit, not by a container's
 * child count. For arrays `names` is `null` and children are read by numeric
 * index; for objects `names` holds the already-enumerated own keys.
 */
interface ContainerCursor {
  readonly container: object;
  readonly names: readonly string[] | null;
  readonly length: number;
  index: number;
  readonly childDepth: number;
}

/**
 * Inspect one container and return its cursor, or `null` for an empty
 * container. Children are guarded but not yet reserved by the caller; no child
 * value is read here, so inherited hooks cannot run.
 *
 * Ordinary arrays are required (`Array.prototype`); Array subclasses, custom
 * prototypes and null-prototype arrays are rejected before any enumeration so
 * inherited hooks such as `length` or `toJSON` are never invoked. Plain objects
 * may have `Object.prototype` or a null prototype and must use ASCII keys.
 */
const openContainer = (
  value: unknown,
  depth: number,
  visited: number,
  scheduled: number,
): ContainerCursor | null => {
  if (value === null || typeof value !== "object") {
    throw new GoJsonV1EncodeError("ErrUnsupportedType", "go-json-v1: unsupported value");
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        "go-json-v1: array is not an ordinary Array",
      );
    }
    const length = value.length;
    guardContainer(visited, scheduled, length, depth);
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        "go-json-v1: array with symbol-keyed property",
      );
    }
    if (Object.getOwnPropertyNames(value).length !== length + 1) {
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        "go-json-v1: array has holes or unsupported own properties",
      );
    }
    if (length === 0) return null;
    return { container: value, names: null, length, index: length - 1, childDepth: depth + 1 };
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GoJsonV1EncodeError("ErrUnsupportedType", "go-json-v1: unsupported object instance");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new GoJsonV1EncodeError("ErrUnsupportedType", "go-json-v1: symbol-keyed property");
  }
  const names = Object.getOwnPropertyNames(value);
  for (const name of names) {
    if (!isAscii(name)) {
      throw new GoJsonV1EncodeError("ErrNonASCIIKey", "go-json-v1: object key must be ASCII");
    }
  }
  guardContainer(visited, scheduled, names.length, depth);
  if (names.length === 0) return null;
  return { container: value, names, length: names.length, index: names.length - 1, childDepth: depth + 1 };
};

/**
 * Bounded iterative type/depth/occurrence validation before serialization.
 *
 * The stack holds at most one cursor per open level. A container's children are
 * reserved (`scheduled += length`) before descent and consumed one at a time
 * (`scheduled -= 1` on visit), so `visited + scheduled` is the number of claimed
 * occurrences and repeated references are counted per occurrence while cycles
 * terminate on the depth/value guards. Child values are read from own data
 * descriptors, so no getter or `toJSON` is ever invoked.
 */
const prewalk = (root: unknown): void => {
  let visited = 0;
  let scheduled = 1; // the root occurrence is reserved until visited
  const stack: ContainerCursor[] = [];
  let value: unknown = root;
  let depth = 1;

  while (true) {
    scheduled -= 1;
    visited += 1;
    if (visited > GO_JSON_V1_MAX_VALUES) {
      throw new GoJsonV1EncodeError(
        "ErrValueLimit",
        `go-json-v1: value occurrences exceed ${GO_JSON_V1_MAX_VALUES}`,
      );
    }
    if (depth > GO_JSON_V1_MAX_DEPTH) {
      throw new GoJsonV1EncodeError(
        "ErrDepthLimit",
        `go-json-v1: nesting exceeds ${GO_JSON_V1_MAX_DEPTH} levels`,
      );
    }

    if (value !== null && typeof value === "object") {
      const cursor = openContainer(value, depth, visited, scheduled);
      if (cursor !== null) {
        scheduled += cursor.length;
        stack.push(cursor);
      }
    } else if (typeof value === "string") {
      if (hasUnpairedSurrogate(value)) {
        throw new GoJsonV1EncodeError(
          "ErrInvalidUTF8",
          "go-json-v1: string is not well-formed Unicode",
        );
      }
    } else if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new GoJsonV1EncodeError(
          "ErrUnsupportedType",
          `go-json-v1: unsafe number ${String(value)}`,
        );
      }
    } else if (typeof value === "bigint") {
      if (value < INT64_MIN || value > INT64_MAX) {
        throw new GoJsonV1EncodeError("ErrInt64Range", "go-json-v1: bigint outside signed int64 range");
      }
    } else if (value !== null && typeof value !== "boolean") {
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        `go-json-v1: unsupported value of type ${typeof value}`,
      );
    }

    // Descend into the top-most non-exhausted cursor, consuming one reserved
    // child occurrence. LIFO order matches the previous per-child stack.
    while (stack.length > 0 && stack[stack.length - 1].index < 0) stack.pop();
    if (stack.length === 0) return;
    const frame = stack[stack.length - 1];
    const index = frame.index;
    frame.index -= 1;
    const key: PropertyKey = frame.names === null ? index : frame.names[index];
    const descriptor = Object.getOwnPropertyDescriptor(frame.container, key);
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !descriptor.enumerable
    ) {
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        "go-json-v1: child is not an enumerable data property",
      );
    }
    value = descriptor.value;
    depth = frame.childDepth;
  }
};

/** Raw ASCII key ordering, matching Go's `strings.Compare` on the sorted map. */
const compareAsciiKeys = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

/**
 * Serialize an already prewalked value. Recursion is bounded by the prewalked
 * depth (≤ 128), and all property values come from own data descriptors.
 */
const serializeValue = (value: unknown): string => {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return escapeGoJsonString(value);
    case "number":
      return String(value);
    case "bigint":
      return value.toString();
    case "object":
      break;
    default:
      throw new GoJsonV1EncodeError(
        "ErrUnsupportedType",
        `go-json-v1: unsupported value of type ${typeof value}`,
      );
  }

  if (Array.isArray(value)) {
    const length = value.length;
    if (length === 0) return "[]";
    const parts: string[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      parts[index] = serializeValue(descriptor?.value);
    }
    return `[${parts.join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(record);
  if (names.length === 0) return "{}";
  names.sort(compareAsciiKeys);
  const parts: string[] = new Array(names.length);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    parts[index] = `${escapeGoJsonString(name)}:${serializeValue(descriptor?.value)}`;
  }
  return `{${parts.join(",")}}`;
};

/**
 * Encode a validated value into canonical `go-json-v1` bytes without a
 * trailing newline. Throws `GoJsonV1EncodeError` for any value outside the
 * restricted view; never mutates the input and never invokes object hooks.
 */
export function encodeGoJsonV1(input: unknown): Uint8Array {
  prewalk(input);
  return new TextEncoder().encode(serializeValue(input));
}
