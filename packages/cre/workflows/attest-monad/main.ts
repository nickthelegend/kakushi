// Entry point compiled to WASM by `cre workflow build|simulate|deploy`.
import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow } from "../../src/attest-workflow.ts";

export async function main() {
  const runner = await Runner.newRunner({ configSchema });
  await runner.run(initWorkflow);
}
