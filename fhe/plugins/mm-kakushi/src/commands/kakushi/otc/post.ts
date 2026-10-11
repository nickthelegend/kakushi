import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import { connect } from "../../../lib/mm.ts";

const inputs = {
  pair: { type: InputFieldType.Text, flag: "pair", message: "Pair, e.g. WMON/USDC", required: true, index: 0 },
  size: { type: InputFieldType.Text, flag: "size", message: "Size (base units)", required: true, index: 1 },
  min: { type: InputFieldType.Text, flag: "min", message: "Minimum price: encrypted on this machine, never revealed unless a taker crosses it", required: true, index: 2 },
} satisfies InputSchema;

export default class KakushiOtcPost extends PluginCommand<Record<string, unknown>> {
  static override description = "Post a dark OTC order with an FHE-encrypted minimum price";
  static override examples = ["<%= config.bin %> kakushi otc post WMON/USDC 1000 3150"];
  static override requiresAuth = true;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "kakushi:otc:post";

  async execute(io: CommandIO) {
    const { pair, size, min } = await io.resolveInputs(inputs);
    return (await connect(this.ctx, io, this.pluginCommandId, true)).otcPost(String(pair), BigInt(String(size)), BigInt(String(min)));
  }

  override successHint(d: Record<string, unknown>): string {
    return `order #${d.orderId} posted; your minimum price is on-chain only as ciphertext`;
  }
}
