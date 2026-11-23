import { describe, expect, it } from "vitest";
import { feedPadding } from "./calibration";

describe("feedPadding", () => {
  it("M2 (feeds top first): moving down pads the top instead of cropping the bottom", () => {
    expect(feedPadding("top", 0, 6)).toEqual({ padTop: 6, padLeft: 0, dx: 0, dy: 0 });
  });
  it("N1 (image rotated, feeds left first): moving right pads the left", () => {
    expect(feedPadding("left", 5, 2)).toEqual({ padTop: 0, padLeft: 5, dx: 0, dy: 2 });
  });
  it("moving toward the leading edge still shifts (crops the leading rows)", () => {
    expect(feedPadding("top", 3, -4)).toEqual({ padTop: 0, padLeft: 0, dx: 3, dy: -4 });
  });
});
