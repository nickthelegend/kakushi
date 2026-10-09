FROM node:22.18-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 KAKUSHI_NEXT_OUTPUT=standalone KAKUSHI_NETWORK=testnet
ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter @kakushi/app build

FROM node:22.18-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 KAKUSHI_NETWORK=testnet \
    KAKUSHI_CONFIG_DIR=/app/config/generated HOSTNAME=0.0.0.0 PORT=3710
COPY --from=build --chown=node:node /repo/packages/app/.next/standalone ./
COPY --from=build --chown=node:node /repo/packages/app/.next/static ./packages/app/.next/static
COPY --from=build --chown=node:node /repo/packages/app/public ./packages/app/public
RUN mkdir -p /app/config/generated && chown node:node /app/config/generated
USER node
EXPOSE 3710
CMD ["node", "packages/app/server.js"]
