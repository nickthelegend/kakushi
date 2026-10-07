// Node-only helpers (filesystem deployments).
import { Kakushi } from "./kakushi.ts";
import { loadDeployments } from "@kakushi/config/deployments";
import { currentNetwork, type Network } from "@kakushi/config";

export function kakushiFromDisk(network: Network = currentNetwork()): Kakushi {
  return new Kakushi({ network, deployments: loadDeployments(network) });
}
