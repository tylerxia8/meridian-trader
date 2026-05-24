// Anchor test entry. Filled in starting Phase 2.
import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

describe("meridian", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  it("scaffold: provider is configured", () => {
    const provider = anchor.AnchorProvider.env();
    expect(provider.connection).to.not.be.undefined;
  });
});
