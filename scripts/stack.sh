#!/usr/bin/env bash
# Kakushi local stack: three anvil forks (Monad testnet hub, Sepolia, Base Sepolia), plus the
# optional Arbitrum Sepolia and OP Sepolia forks when KAKUSHI_EXTRA_FORKS names them
# ("arbitrumSepolia", "opSepolia" or "all"; comma or space separated).
# Processes are tracked by PID in .stack/pids and stopped ONLY by PID (shared machine:
# never pkill/killall). Ports: 18710 Monad, 18711 Sepolia, 18712 Base Sepolia,
# 18713 Arbitrum Sepolia, 18714 OP Sepolia.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.stack"
mkdir -p "$STATE"
PIDS="$STATE/pids"

# archive endpoints: a fork reads state at its fork block, which pruned RPCs drop after a few minutes
MONAD_FORK_URL="${MONAD_FORK_URL:-https://rpc-testnet.monadinfra.com}"
SEPOLIA_FORK_URL="${SEPOLIA_FORK_URL:-https://sepolia.gateway.tenderly.co}"
BASE_FORK_URL="${BASE_SEPOLIA_FORK_URL:-https://sepolia.base.org}"
ARBITRUM_FORK_URL="${ARBITRUM_SEPOLIA_FORK_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
OP_FORK_URL="${OP_SEPOLIA_FORK_URL:-https://sepolia.optimism.io}"
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

# ports of the forks this `up` starts: the core three, then the requested optional ones
PORTS="18710 18711 18712"
EXTRA=" $(echo "${KAKUSHI_EXTRA_FORKS:-}" | tr ',' ' ') "
for x in $EXTRA; do
  case "$x" in
    arbitrumSepolia|opSepolia|all) ;;
    *) echo "unknown KAKUSHI_EXTRA_FORKS entry: $x (use arbitrumSepolia, opSepolia or all)" >&2; exit 2 ;;
  esac
done
want_extra() { [[ "$EXTRA" == *" $1 "* || "$EXTRA" == *" all "* ]]; }
if want_extra arbitrumSepolia; then PORTS="$PORTS 18713"; fi
if want_extra opSepolia; then PORTS="$PORTS 18714"; fi

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
    # Preflight before replacing ownership records. A second up must not orphan
    # already running forks, and partial startup must roll back only our PIDs.
    for p in $PORTS; do
      if lsof -ti "tcp:$p" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "port $p already in use; keep existing ownership records" >&2
        exit 1
      fi
    done
    if [ -f "$PIDS" ]; then
      while read -r name pid port; do
        if kill -0 "$pid" 2>/dev/null; then
          echo "tracked $name ($pid) still running; stop it before starting" >&2
          exit 1
        fi
      done <"$PIDS"
    fi
    : >"$PIDS"
    rollback() {
      while read -r name pid port; do kill "$pid" 2>/dev/null || true; done <"$PIDS"
      : >"$PIDS"
    }
    trap rollback EXIT
    trap 'exit 130' INT TERM
    start_one monad 18710 "$MONAD_FORK_URL" "$BLOCK_TIME_MONAD"
    start_one sepolia 18711 "$SEPOLIA_FORK_URL" "$BLOCK_TIME_L1"
    start_one base 18712 "$BASE_FORK_URL" "$BLOCK_TIME_L1"
    if want_extra arbitrumSepolia; then start_one arbitrum 18713 "$ARBITRUM_FORK_URL" "$BLOCK_TIME_L1"; fi
    if want_extra opSepolia; then start_one op 18714 "$OP_FORK_URL" "$BLOCK_TIME_L1"; fi
    for p in $PORTS; do wait_rpc "$p"; done
    for p in $PORTS; do echo "port $p chain $(cast chain-id --rpc-url http://127.0.0.1:$p)"; done
    trap - EXIT INT TERM
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
