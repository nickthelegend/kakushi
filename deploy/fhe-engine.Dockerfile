# kakushi-fhe-engine (Rust, tfhe-rs 1.8.1) for Kakushi Confidential on Monad testnet. Private only: the gateway
# reaches it over the host's private network; it holds the network client key, so it never gets a public domain.
# Keys are generated inside the container on first start (load_or_generate) under $KAKUSHI_FHE_DIR/keys and
# ciphertexts land in $KAKUSHI_FHE_DIR/ct: mount a persistent volume at $KAKUSHI_FHE_DIR so restarts keep both.
FROM rust:1.94-bookworm AS build
WORKDIR /src
COPY fhe/engine/Cargo.toml fhe/engine/Cargo.lock ./
COPY fhe/engine/src ./src
RUN cargo build --release --locked && strip target/release/kakushi-fhe-engine

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/kakushi-fhe-engine /usr/local/bin/kakushi-fhe-engine
ENV KAKUSHI_FHE_DIR=/data KAKUSHI_FHE_ENGINE_HOST=:: KAKUSHI_FHE_ENGINE_PORT=8899
EXPOSE 8899
CMD ["sh", "-c", "umask 077 && exec kakushi-fhe-engine serve --dir \"$KAKUSHI_FHE_DIR\" --port \"$KAKUSHI_FHE_ENGINE_PORT\""]
