"""Parse and validate Bridges-2 mergesort output into CSV files.

usage: python3 parse.py <job output> [<job output> ...]

Every run block ("=== ...") must contain exactly the expected timing
lines, all times must be positive, and each configuration must have
the expected number of runs. Any violation is reported and the script
exits non-zero.
"""
import csv
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HEADER = re.compile(r"^=== (?:(?P<exp>[A-D]) )?(?:threads=(?P<t>\d+)|(?P<prof>prof\d+)) run=(?P<run>\d+)$")
SECTION_N = {"A": 10_000_000, "B": 50_000_000, "C": 10_000_000, "D": 10_000_000}
FIELDS = {
    "Top-level sequential merge took": "seq_merge",
    "Sequential mergesort took": "seq",
    "Top-level merge in parallel run took": "par_merge",
    "Parallel mergesort took": "par",
    "Built-in qsort took": "qsort",
}
TIME = re.compile(r"^(?P<label>.+?): (?P<sec>[0-9.]+) sec\.$")
PROF = re.compile(r"^merge level=(?P<level>\d+) size=(?P<size>\d+) took: (?P<sec>[0-9.]+) sec\.$")

errors = []


def parse(path):
    runs, prof = [], []
    cur = None
    for lineno, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.rstrip()
        where = f"{path}:{lineno}"
        if re.search(r"Oops|ERROR|error|Segmentation|Killed", line):
            errors.append(f"{where}: failure line: {line}")
        m = HEADER.match(line)
        if m:
            exp = m["exp"] or "main"
            if m["prof"]:
                t = int(m["prof"][4:])
            else:
                t = int(m["t"])
            cur = {"file": Path(path).name, "exp": exp, "threads": t,
                   "run": int(m["run"]), "n": SECTION_N.get(exp, 10_000_000),
                   "build": "-O2" if exp == "D" else "-O0",
                   "profile": bool(m["prof"]), "lineno": lineno}
            runs.append(cur)
            continue
        if cur is None:
            continue
        m = PROF.match(line)
        if m:
            prof.append({"file": cur["file"], "threads": cur["threads"], "run": cur["run"],
                         "level": int(m["level"]), "size": int(m["size"]),
                         "sec": float(m["sec"])})
            continue
        m = TIME.match(line)
        if m and m["label"] in FIELDS:
            key = FIELDS[m["label"]]
            if key in cur:
                errors.append(f"{where}: duplicate '{m['label']}' in run")
            cur[key] = float(m["sec"])
        elif line.startswith("###") or line.startswith("JobID") or "|" in line:
            cur = None
    return runs, prof


def check(runs, prof):
    for r in runs:
        want = ["seq_merge", "seq", "par", "qsort"] + (["par_merge"] if r["threads"] > 1 else [])
        for k in want:
            if k not in r:
                errors.append(f"{r['file']}:{r['lineno']}: run missing {k}")
            elif r[k] <= 0:
                errors.append(f"{r['file']}:{r['lineno']}: non-positive {k}={r[k]}")
        if r["threads"] == 1 and "par_merge" in r:
            errors.append(f"{r['file']}:{r['lineno']}: 1-thread run has a parallel merge line")
    # profile runs: one merge per internal node of the thread tree
    byrun = defaultdict(list)
    for p in prof:
        byrun[(p["file"], p["threads"], p["run"])].append(p)
    for key, ps in byrun.items():
        t = key[1]
        if len(ps) != t - 1:
            errors.append(f"{key}: expected {t - 1} profiled merges, got {len(ps)}")
        if sum(p["size"] for p in ps if p["level"] == max(q["level"] for q in ps)) != 10_000_000:
            errors.append(f"{key}: top-level profiled merge size is not N")


def counts(runs, expected):
    c = defaultdict(int)
    for r in runs:
        c[(r["file"], r["exp"], r["threads"])] += 1
    for k, v in sorted(c.items()):
        if v != expected.get(k[1], v):
            errors.append(f"{k}: {v} runs, expected {expected[k[1]]}")
    return c


def summarize(runs):
    groups = defaultdict(list)
    for r in runs:
        if not r["profile"]:
            groups[(r["exp"], r["build"], r["n"], r["threads"])].append(r)
    rows = []
    for (exp, build, n, t), rs in sorted(groups.items()):
        row = {"exp": exp, "build": build, "n": n, "threads": t, "runs": len(rs)}
        for k in ["seq", "par", "seq_merge", "par_merge", "qsort"]:
            vals = [r[k] for r in rs if k in r]
            if vals:
                row[f"{k}_mean"] = statistics.mean(vals)
                row[f"{k}_sd"] = statistics.stdev(vals) if len(vals) > 1 else 0.0
                row[f"{k}_min"] = min(vals)
                row[f"{k}_max"] = max(vals)
        row["speedup"] = row["seq_mean"] / row["par_mean"]
        paired = [r["seq"] / r["par"] for r in rs]
        row["speedup_paired_mean"] = statistics.mean(paired)
        row["speedup_paired_sd"] = statistics.stdev(paired) if len(paired) > 1 else 0.0
        row["efficiency"] = row["speedup"] / t
        rows.append(row)
    return rows


def write_csv(path, rows):
    keys = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = Path(__file__).resolve().parent.parent / "results"
    runs, prof = [], []
    for p in sys.argv[1:]:
        r, q = parse(p)
        runs += r
        prof += q
    check(runs, prof)
    c = counts(runs, {"main": 5, "A": 5, "B": 3, "C": 3, "D": 3})
    print(f"{len(runs)} runs, {len(prof)} profiled merges, {len(c)} configurations")
    for k, v in sorted(c.items()):
        print(f"  {k[1]:>4} threads={k[2]:<3} runs={v}")
    # Leave earlier CSVs untouched rather than write partial results.
    if errors:
        print(f"\n{len(errors)} VALIDATION ERRORS:")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    write_csv(out / "runs.csv", [{k: v for k, v in r.items() if k != "lineno"} for r in runs])
    write_csv(out / "summary.csv", summarize(runs))
    if prof:
        write_csv(out / "merge_profile.csv", prof)
    print("validation: OK")


if __name__ == "__main__":
    main()
