"""Run a real command in a pseudo-terminal and record its output with timestamps (for an xterm.js replay at real speed).
Usage: python3 capture_cli.py out.json cwd 'command'"""
import json, os, pty, select, subprocess, sys, time, fcntl, termios, struct
out, cwd, cmd = sys.argv[1], sys.argv[2], sys.argv[3]
m, s = pty.openpty()
fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 118, 0, 0))
env = {**os.environ, "TERM": "xterm-256color", "COLUMNS": "118", "LINES": "40"}
t0 = time.time()
p = subprocess.Popen(["/bin/zsh", "-lc", cmd], cwd=cwd, stdin=s, stdout=s, stderr=s, env=env, close_fds=True)
os.close(s)
chunks = []
while True:
    r, _, _ = select.select([m], [], [], 0.2)
    if m in r:
        try:
            d = os.read(m, 65536)
        except OSError:
            break
        if not d:
            break
        chunks.append({"t": int((time.time() - t0) * 1000), "d": d.decode("utf8", "replace")})
        sys.stdout.write(d.decode("utf8", "replace")); sys.stdout.flush()
    elif p.poll() is not None:
        break
p.wait()
json.dump({"command": cmd, "cwd": cwd, "startedAt": time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(t0)), "exit": p.returncode,
           "ms": int((time.time() - t0) * 1000), "chunks": chunks}, open(out, "w"), indent=1)
print(f"\n[captured] {len(chunks)} chunks, {time.time() - t0:.1f}s, exit {p.returncode}")
