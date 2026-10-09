import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { connect } from "../../../lib/mm.ts";

export default class FhishCusdcBalance extends PluginCommand<Record<string, unknown>> {
  static override description = "Reveal your confidential USDC balance to you alone (EIP-712 signature; the result is sealed to this process)";
  static override examples = ["<%= config.bin %> fhish cusdc balance"];
  static override requiresAuth = true;
  protected readonly pluginCommandId = "fhish:cusdc:balance";

  async execute(io: CommandIO) {
    return (await connect(this.ctx, io, this.pluginCommandId, true)).cusdcBalance();
  }
}
