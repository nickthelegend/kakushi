import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { connect } from "../../../lib/mm.ts";

const inputs = {
  order: { type: InputFieldType.Text, flag: "order", message: "Order id (see `mm fhish otc orders`)", required: true, index: 0 },
  max: { type: InputFieldType.Text, flag: "max", message: "Maximum price: encrypted; a miss reveals nothing", required: true, index: 1 },
} satisfies InputSchema;

export default class FhishOtcTake extends PluginCommand<Record<string, unknown>> {
  static override description = "Take a dark OTC order with an FHE-encrypted maximum price; waits for the encrypted comparison";
  static override examples = ["<%= config.bin %> fhish otc take 0 3200"];
  static override requiresAuth = true;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "fhish:otc:take";

  async execute(io: CommandIO) {
    const { order, max } = await io.resolveInputs(inputs);
    return (await connect(this.ctx, io, this.pluginCommandId, true)).otcTake(BigInt(String(order)), BigInt(String(max)));
  }

  override successHint(d: Record<string, unknown>): string {
    return d.crossed ? `crossed at ${d.price} (the maker's price; your maximum stays secret)` : "no match; neither price was revealed";
  }
}
