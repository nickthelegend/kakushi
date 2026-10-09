import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { connect } from "../../../lib/mm.ts";

const inputs = {
  amount: { type: InputFieldType.Text, flag: "amount", message: "Bid: encrypted here; only the winning bid is ever revealed", required: true, index: 0 },
} satisfies InputSchema;

export default class FhishAuctionBid extends PluginCommand<Record<string, unknown>> {
  static override description = "Place a sealed bid (FHE-encrypted) in the Fhish auction";
  static override examples = ["<%= config.bin %> fhish auction bid 1500"];
  static override requiresAuth = true;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "fhish:auction:bid";

  async execute(io: CommandIO) {
    const { amount } = await io.resolveInputs(inputs);
    return (await connect(this.ctx, io, this.pluginCommandId, true)).auctionBid(BigInt(String(amount)));
  }
}
