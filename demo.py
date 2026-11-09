"""Walk through PA3 task by task for the demo.

usage: python3 demo.py [--no-pause] [-n N] [--open]

Builds the 1/2/4/8/16-thread executables locally (the same sed edit of
THREAD_LEVEL that run.sbatch does on Bridges-2), runs them, prints the
relevant code, and shows the Bridges-2 numbers from results/.
--open also opens the figures in Preview (macOS).
"""
import argparse
import csv
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "parallelMergesort.c"
RES = ROOT / "results"


def banner(title):
    print("\n" + "=" * 72 + "\n" + title + "\n" + "=" * 72)


def pause(args):
    if not args.no_pause:
        input("\n[Enter for next task] ")


def show_code(start_pat, nlines, label):
    lines = SRC.read_text().splitlines()
    for i, l in enumerate(lines):
        if re.search(start_pat, l):
            print(f"--- {label}: parallelMergesort.c lines {i + 1}-{i + nlines}")
            for j in range(i, i + nlines):
                print(f"{j + 1:4d}  {lines[j].expandtabs(4)}")
            return
    print(f"(could not find {label})")


def read_csv(name):
    p = RES / name
    if not p.exists():
        return []
    with open(p) as f:
        return list(csv.DictReader(f))


def build(tmp, level):
    t = 1 << level
    src = re.sub(r"^(#define\s+THREAD_LEVEL\s+)\d+", rf"\g<1>{level}", SRC.read_text(), flags=re.M)
    if f"#define THREAD_LEVEL {level}" not in src:
        sys.exit("could not set THREAD_LEVEL")
    c = tmp / f"ms{t}.c"
    c.write_text(src)
    exe = tmp / f"mergesort{t}"
    cmd = ["gcc", "-o", str(exe), str(c), "-lpthread"]
    print("$ " + " ".join(["gcc", "-o", f"mergesort{t}", "parallelMergesort.c", "-lpthread"]) + f"   # THREAD_LEVEL {level}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr)
    return exe


def run(exe, n):
    print(f"$ ./{exe.name} {n}")
    r = subprocess.run([str(exe), str(n)], capture_output=True, text=True)
    print(r.stdout, end="")
    if r.returncode != 0 or "Oops" in r.stdout:
        sys.exit(f"run failed (exit {r.returncode})")
    vals = dict(re.findall(r"^(.+?) took: ([0-9.]+) sec\.$", r.stdout, re.M))
    return {k: float(v) for k, v in vals.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-pause", action="store_true")
    ap.add_argument("-n", type=int, default=10_000_000)
    ap.add_argument("--open", action="store_true")
    args = ap.parse_args()
    if args.n < 2:
        sys.exit("N must be at least 2")
    figs = RES / "figs"

    tmp = Path(tempfile.mkdtemp(prefix="pa3demo"))
    banner("Task 1: speedup with 1, 2, 4, 8, 16 threads")
    print("THREAD_LEVEL L creates 2^L threads; each build changes only that #define.\n")
    exes = {1 << L: build(tmp, L) for L in range(5)}
    print(f"\nLocal run on this machine, N = {args.n:,} (one run each):")
    local = {}
    for t, exe in exes.items():
        print()
        v = run(exe, args.n)
        local[t] = v["Sequential mergesort"] / v["Parallel mergesort"]
    print("\nlocal speedup: " + "  ".join(f"{t}:{s:.2f}" for t, s in local.items()))
    summ = [r for r in read_csv("summary.csv") if r["exp"] == "main"]
    if summ:
        print("\nBridges-2 results (job 50358707, 16 cores, mean of 5 runs):")
        print(f"{'threads':>8} {'seq (s)':>9} {'par (s)':>9} {'speedup':>8} {'efficiency':>11}")
        for r in summ:
            print(f"{r['threads']:>8} {float(r['seq_mean']):9.3f} {float(r['par_mean']):9.3f} "
                  f"{float(r['speedup']):8.2f} {100 * float(r['efficiency']):10.0f}%")
    if args.open:
        subprocess.run(["open", figs / "fig1_speedup.png", figs / "fig2_times.png"])
    pause(args)

    banner("Task 2: timing the top-level sequential merge, Amdahl's Law")
    show_code(r"^void mergeSort\(double lyst\[\], int size\)$", 19, "sequential top-level merge timer")
    print()
    show_code(r"//Call the sequential merge now", 11, "parallel top-level merge timer")
    k = {r["name"]: float(r["value"]) for r in read_csv("constants.csv")}
    if k:
        T1, Tm = k["T1_seq_mergesort_s"], k["Tm_top_merge_s"]
        print(f"""
Bridges-2: T1 = {T1:.4f} s (sequential mergesort), Tm = {Tm:.4f} s (top-level merge)
Check: Tm * log2(N) = {Tm:.4f} * {math.log2(1e7):.2f} = {Tm * math.log2(1e7):.3f} s  ~ T1  (each merge level costs ~Tm)

Why more than Tm is serial: with p = 2^L threads, merge level k runs 2^k merges
of N/2^k at once, so it takes Tm/2^k while most cores sit idle:
  Ts = Tm (1 + 1/2 + ... + 1/2^(L-1)) = Tm (2 - 2^(1-L))  ->  2 Tm
f = 2 Tm / T1 = {2 * Tm / T1:.4f}
Amdahl: S(16) = 1/(f + (1-f)/16) = {k['amdahl_16']:.2f}   S(inf) = 1/f = {k['Smax']:.1f}
Top merge only (f = {Tm / T1:.4f}) would predict S(16) = {k['amdahl_16_naive']:.2f}; measured S(16) = """
              + next((f"{float(r['speedup']):.2f}" for r in summ if r["threads"] == "16"), "?"))
    if args.open:
        subprocess.run(["open", figs / "fig3_amdahl.png"])
    pause(args)

    banner("Task 3: computational DAG and work-span")
    print("""DAG for THREAD_LEVEL = 2 (4 threads); node label = work (c = cost per element):

                     start O(1)
                 /               \\
          fork O(1)             fork O(1)
          /      \\              /      \\
   sort N/4   sort N/4    sort N/4   sort N/4      each c(N/4)lg(N/4)
          \\      /              \\      /
        merge N/2              merge N/2          each c N/2
                 \\               /
                     merge N                      c N

Work  W = cN lg N + O(p)                         (same as sequential)
Span  S = c(N/p)lg(N/p) + cN(1 + 1/2 + ... ) + O(lg p)  ->  ~2cN
Parallelism W/S -> (lg N)/2 ~ 11.6 for N = 10^7: the sequential merge is the
critical path. Fix: parallel merge (Grossman 5.4), span O(log^2 N).""")
    am = read_csv("amdahl.csv")
    if am:
        print(f"\n{'p':>4} {'span (s)':>9} {'W/p (s)':>8} {'bound (s)':>10} {'measured (s)':>13}")
        for r in am:
            if r["threads"] == "1":
                continue
            print(f"{r['threads']:>4} {float(r['workspan_Tp_s']):9.3f} {k['T1_seq_mergesort_s'] / int(r['threads']):8.3f} "
                  f"{float(r['lower_bound_s']):10.3f} {r['measured_par_s'] or '-':>13}")
        print("Every measured time is above max(W/p, span), as the work and span laws require.")
    if args.open:
        subprocess.run(["open", figs / "fig6_dag.png"])
    pause(args)

    banner("Task 4: difficulties and what I learned")
    print("Nothing to run. See the Task 4 section of PA3 Report.pdf.")
    print("\nDone.")


if __name__ == "__main__":
    main()
