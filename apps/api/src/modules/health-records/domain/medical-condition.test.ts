import { describe, expect, it } from "vitest";
import { assertValidConditionDates } from "./medical-condition.js";

describe("assertValidConditionDates (schema.md §3: until >= since)", () => {
  it.each([
    [undefined, undefined],
    ["2020-01-01", undefined],
    [undefined, "2020-01-01"],
    ["2020-01-01", "2020-01-01"],
    ["2020-01-01", "2020-06-01"],
  ])("aceita since=%j until=%j", (since, until) => {
    expect(() => {
      assertValidConditionDates(since, until);
    }).not.toThrow();
  });

  it("rejeita until anterior a since", () => {
    expect(() => {
      assertValidConditionDates("2020-06-01", "2020-01-01");
    }).toThrow();
  });
});
