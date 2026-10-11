import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { connect } from "../../lib/mm.ts";

export default class KakushiStatus extends PluginCommand<Record<string, unknown>> {
  static override description = "Kakushi on Monad: network, gateway, FHE engine and confidential app addresses";
  static override examples = ["<%= config.bin %> kakushi status"];
  static override requiresAuth = true;
  protected readonly pluginCommandId = "kakushi:status";

  async execute(io: CommandIO) {
    return (await connect(this.ctx, io, this.pluginCommandId, false)).status();
  }
}
