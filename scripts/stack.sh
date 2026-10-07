#!/usr/bin/env bash
# Kakushi local stack: three anvil forks (Monad testnet hub, Sepolia, Base Sepolia).
# Processes are tracked by PID in .stack/pids and stopped ONLY by PID (shared machine:
# never pkill/killall). Ports: 18710 Monad, 18711 Sepolia, 18712 Base Sepolia.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.stack"
mkdir -p "$STATE"
PIDS="$STATE/pids"

MONAD_FORK_URL="${MONAD_FORK_URL:-https://testnet-rpc.monad.xyz}"
SEPOLIA_FORK_URL="${SEPOLIA_FORK_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
BASE_FORK_URL="${BASE_SEPOLIA_FORK_URL:-https://sepolia.base.org}"
BLOCK_TIME_MONAD="${KAKUSHI_MONAD_BLOCK_TIME:-1}"
BLOCK_TIME_L1="${KAKUSHI_L1_BLOCK_TIME:-2}"

start_one() {
  local name=$1 port=$2 url=$3 bt=$4
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port already in use; not starting $name" >&2
    return 1
  fi
  anvil --port "$port" --fork-url "$url" --block-time "$bt" --prune-history 300 \
    --silent >"$STATE/$name.log" 2>&1 &
  echo "$name $! $port" >>"$PIDS"
}

wait_rpc() {
  local port=$1
  for _ in $(seq 1 60); do
    if cast chain-id --rpc-url "http://127.0.0.1:$port" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "anvil on $port did not come up (see .stack/*.log)" >&2
  return 1
}

case "${1:-status}" in
  up)
    : >"$PIDS"
    start_one monad 18710 "$MONAD_FORK_URL" "$BLOCK_TIME_MONAD"
    start_one sepolia 18711 "$SEPOLIA_FORK_URL" "$BLOCK_TIME_L1"
    start_one base 18712 "$BASE_FORK_URL" "$BLOCK_TIME_L1"
    for p in 18710 18711 18712; do wait_rpc "$p"; done
    for p in 18710 18711 18712; do echo "port $p chain $(cast chain-id --rpc-url http://127.0.0.1:$p)"; done
    ;;
  down)
    if [ -f "$PIDS" ]; then
      while read -r name pid port; do
        if kill -0 "$pid" 2>/dev/null; then kill "$pid" && echo "stopped $name ($pid)"; fi
      done <"$PIDS"
      : >"$PIDS"
    fi
    ;;
  status)
    [ -f "$PIDS" ] && while read -r name pid port; do
      if kill -0 "$pid" 2>/dev/null; then echo "$name pid=$pid port=$port up"; else echo "$name pid=$pid port=$port DOWN"; fi
    done <"$PIDS"
    ;;
  *) echo "usage: stack.sh up|down|status" >&2; exit 2 ;;
esac
