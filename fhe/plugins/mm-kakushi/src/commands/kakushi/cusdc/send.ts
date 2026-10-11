import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";
import type { Hex } from "viem";
import { connect } from "../../../lib/mm.ts";

const inputs = {
  to: { type: InputFieldType.Text, flag: "to", message: "Recipient address", required: true, index: 0 },
  amount: { type: InputFieldType.Text, flag: "amount", message: "Amount in USDC base units (6 decimals); stays encrypted", required: true, index: 1 },
} satisfies InputSchema;

export default class KakushiCusdcSend extends PluginCommand<Record<string, unknown>> {
  static override description = "Send confidential USDC: the amount and both balances stay encrypted on-chain";
  static override examples = ["<%= config.bin %> kakushi cusdc send 0xabc… 10000000"];
  static override requiresAuth = true;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "kakushi:cusdc:send";

  async execute(io: CommandIO) {
    const { to, amount } = await io.resolveInputs(inputs);
    return (await connect(this.ctx, io, this.pluginCommandId, true)).cusdcSend(String(to) as Hex, BigInt(String(amount)));
  }
}
