import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { connect } from "../../lib/mm.ts";

export default class FhishStatus extends PluginCommand<Record<string, unknown>> {
  static override description = "Fhish on Monad: network, gateway, FHE engine and confidential app addresses";
  static override examples = ["<%= config.bin %> fhish status"];
  static override requiresAuth = true;
  protected readonly pluginCommandId = "fhish:status";

  async execute(io: CommandIO) {
    return (await connect(this.ctx, io, this.pluginCommandId, false)).status();
  }
}
