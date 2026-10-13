# Kakushi Confidential coprocessor + gateway + KMS (fhe/coprocessor) for Monad testnet: the only public FHE endpoint.
# Signer keys come from the host's KAKUSHI_FHE_SECRETS_JSON variable, never from the image. The log cursor goes to
# $KAKUSHI_FHE_STATE_DIR (a small volume, so a restart resumes instead of rescanning from the deploy block).
FROM node:22.18-bookworm-slim
WORKDIR /fhe
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
COPY fhe/package.json fhe/pnpm-lock.yaml fhe/pnpm-workspace.yaml ./
COPY fhe/coprocessor/package.json ./coprocessor/
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter @kakushi/fhe-coprocessor
COPY fhe/coprocessor/src ./coprocessor/src
COPY fhe/contracts/deployments/testnet.json ./contracts/deployments/testnet.json
ENV NODE_ENV=production KAKUSHI_FHE_NETWORK=testnet KAKUSHI_FHE_DEPLOYMENT=/fhe/contracts/deployments/testnet.json \
    RPC_URL=https://testnet-rpc.monad.xyz DELIVER=direct DECRYPT_AT=finalized GATEWAY_PORT=8890 \
    KAKUSHI_FHE_STATE_DIR=/state
EXPOSE 8890
CMD ["node", "coprocessor/src/main.ts"]
