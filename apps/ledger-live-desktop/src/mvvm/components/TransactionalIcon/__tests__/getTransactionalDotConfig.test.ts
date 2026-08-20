import { ArrowDown, ArrowUp, Close } from "@ledgerhq/lumen-ui-react/symbols";
import { getTransactionalDotConfig } from "../getTransactionalDotConfig";

describe("getTransactionalDotConfig", () => {
  it("resolves symbol strings to actual icon components", () => {
    expect(getTransactionalDotConfig("IN", false)).toEqual({
      icon: ArrowDown,
      appearance: "success",
    });
  });

  it("resolves success arrow for pending state (no spinner)", () => {
    expect(getTransactionalDotConfig("OUT", true)).toEqual({
      icon: ArrowUp,
      appearance: "success",
    });
  });

  it("resolves Close for failed state", () => {
    expect(getTransactionalDotConfig("OUT", false, true)).toEqual({
      icon: Close,
      appearance: "error",
    });
  });

  it("returns null when common helper returns null", () => {
    expect(getTransactionalDotConfig("NONE", false)).toBeNull();
  });
});
