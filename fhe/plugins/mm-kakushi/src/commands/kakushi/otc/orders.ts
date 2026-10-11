import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { connect } from "../../../lib/mm.ts";

type Orders = { orders: { id: number; maker: string; pair: string; size: string; open: boolean }[] };

export default class KakushiOtcOrders extends PluginCommand<Orders> {
  static override description = "List dark OTC orders. Limit prices are encrypted, so only pair, size and status are visible";
  static override examples = ["<%= config.bin %> kakushi otc orders"];
  static override requiresAuth = true;
  protected readonly pluginCommandId = "kakushi:otc:orders";

  async execute(io: CommandIO) {
    return { orders: await (await connect(this.ctx, io, this.pluginCommandId, false)).otcOrders() };
  }
}
