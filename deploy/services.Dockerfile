# Kakushi's Node services (relayer, indexer, maker, watchtower, attester) in one image. KAKUSHI_SERVICE picks
# which one runs; each reads its keys and ports from the host's environment, never from the image.
FROM node:22.18-bookworm-slim
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
COPY . .
# only what the services import: no Next.js app, no FHE workspace (the indexer resolves from the root)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter kakushi --filter "@kakushi/relayer..." --filter "@kakushi/maker..." --filter "@kakushi/watchtower..." --filter "@kakushi/cre..."
ENV NODE_ENV=production KAKUSHI_NETWORK=testnet
# the attester is the CRE runner (packages/cre/local/runner.ts), labelled as such: not a Chainlink DON
CMD ["sh", "-c", "case \"$KAKUSHI_SERVICE\" in relayer|indexer|maker|watchtower) exec node \"packages/$KAKUSHI_SERVICE/src/main.ts\";; attester) exec node packages/cre/local/runner.ts;; *) echo \"KAKUSHI_SERVICE must be relayer, indexer, maker, watchtower or attester\" >&2; exit 1;; esac"]
