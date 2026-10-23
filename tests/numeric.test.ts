import { describe, expect, it } from "vitest";
import { committedInteger } from "../src/components/NumericField";

describe("committed numeric edits", () => {
  it("allows a complete 20 minute entry without clamping its first digit", () => {
    expect(committedInteger("2", 5, 120)).toBeNull();
    expect(committedInteger("20", 5, 120)).toBe(20);
  });
  it.each(["", " ", "4", "121", "1.5", "1e2", "-20", "NaN"])(
    "rejects invalid draft %s without substituting another value",
    (draft) => {
      expect(committedInteger(draft, 5, 120)).toBeNull();
    },
  );
  it("supports slot boundaries and normalizes harmless surrounding spaces", () => {
    expect(committedInteger("1", 1, 32)).toBe(1);
    expect(committedInteger("32", 1, 32)).toBe(32);
    expect(committedInteger(" 20 ", 5, 120)).toBe(20);
    expect(committedInteger("33", 1, 32)).toBeNull();
  });
});
