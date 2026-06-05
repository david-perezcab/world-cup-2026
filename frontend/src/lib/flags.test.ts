import { describe, expect, it } from "vitest";
import { flagUrlFor, teamCodeFor } from "./flags";

describe("flagUrlFor", () => {
  it("returns image URLs for country names", () => {
    expect(flagUrlFor("Mexico")).toBe("https://flagcdn.com/w40/mx.png");
    expect(flagUrlFor("England")).toBe("https://flagcdn.com/w40/gb-eng.png");
  });

  it("does not return a flag for bracket placeholders", () => {
    expect(flagUrlFor("W73")).toBeNull();
  });

  it("returns three-letter team codes for match cards", () => {
    expect(teamCodeFor("Mexico")).toBe("MEX");
    expect(teamCodeFor("South Korea")).toBe("KOR");
  });
});
