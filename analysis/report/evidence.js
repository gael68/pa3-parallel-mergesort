// End of Task 1: evidence from job 50358766 that the threads really ran in parallel,
// plus the perf counters and the input-size sweep.
module.exports = (R) => {
  const { P, H2, Tbl, Caption, Code, f2, f3, f4, csv, raw, gap } = R;
  const out = [];
  const log = raw("pa3-evidence-50358766.out").split("\n");
  const sect = (start, end) => {
    const i = log.findIndex((l) => l.startsWith(start));
    const j = log.findIndex((l, k) => k > i && l.startsWith(end));
    return log.slice(i, j);
  };
  const get = (lines, key) => (lines.find((l) => l.includes(key)) || "").split(":").pop().trim();
  const E1 = sect("=== E threads=1", "=== E threads=16");
  const E16 = sect("=== E threads=16", "### F");
  const S = csv("summary.csv");
  const by = (exp, n, t) => S.find((r) => r.exp === exp && r.n === n && r.threads === t);

  out.push(H2("Evidence that the threads really run in parallel (job 50358766)"));
  out.push(P("A third job on the same kind of 16-core allocation (node r227, CPUs 49–63 and 127) collected direct evidence of what the threads do."));

  // F: ps -L snapshot
  const F = sect("=== F after", "=== F program output");
  const rows = F.slice(2).filter((l) => l.trim());
  const running = rows.filter((l) => / R/.test(l));
  const cpus = new Set(running.map((l) => l.trim().split(/\s+/)[2]));
  out.push(P(`**Thread snapshot.** I started \`mergesort16\` on 100,000,000 elements and ran \`ps -L\` once it had created its threads (${F[0].replace("=== F ", "")}). The PSR column is the CPU each thread is on, and STAT R means running, S sleeping:`));
  out.push(...Code(F.slice(1, 1 + 1 + rows.length)));
  out.push(P(`There are ${rows.length} threads: the main thread plus 2^5 − 1 = 31 created by \`parallelMergeSortHelper\` with THREAD_LEVEL 4. **${running.length} are running, each on a different CPU** (${cpus.size} distinct CPUs, exactly the 16 Slurm gave the job). These are the 16 leaf threads sorting N/16 elements each. The other ${rows.length - running.length} are sleeping: the main thread and the 15 internal threads, blocked in \`pthread_join\` until their children finish, after which each one does its merge. These are the fork and merge nodes of the DAG in Task 3.`));

  // E: /usr/bin/time -v
  const u1 = +get(E1, "User time"), u16 = +get(E16, "User time");
  const wall = (lines) => (lines.find((l) => l.includes("Elapsed")) || "").split("): ").pop().trim();
  const w1 = wall(E1), w16 = wall(E16);
  out.push(P(`**CPU time.** \`/usr/bin/time -v\` on the whole program (sequential sort, parallel sort and qsort) for 1 and 16 threads, N = 10,000,000:`));
  out.push(Caption("Table 2. /usr/bin/time -v, whole program (verbatim values).", true));
  out.push(Tbl(["Threads", "User CPU time (s)", "Wall-clock time", "Percent of CPU this job got", "Parallel mergesort (s)"], [
    [1, u1.toFixed(2), w1, get(E1, "Percent of CPU"), get(E1, "Parallel mergesort")],
    [16, u16.toFixed(2), w16, get(E16, "Percent of CPU"), get(E16, "Parallel mergesort")],
  ], [1100, 1900, 1800, 2600, 1960]), gap());
  out.push(P(`The total CPU time is the same (${u1.toFixed(2)} s vs ${u16.toFixed(2)} s), so the parallel version does the same work and only spreads it over more cores; this is the work law from Task 3 (W = T1). The wall-clock time drops by about the time the parallel sort saved. The CPU percentage for the whole program is only ${get(E16, "Percent of CPU")} because the sequential mergesort and qsort, which take most of the run, use one core. This is also why Slurm's \`seff\` reports low CPU efficiency for these jobs.`));

  // G: perf
  const G1 = sect("=== G threads=1", "=== G threads=16"), G16 = sect("=== G threads=16", "### H");
  const num = (lines, ev) => { const l = lines.find((x) => x.includes(ev + ":u") || x.includes(ev)); return l ? l.trim().split(/\s+/)[0] : "–"; };
  const ipc = (lines) => { const l = lines.find((x) => x.includes("insn per cycle")); return l ? l.split("#")[1].trim().split(/\s+/)[0] : "–"; };
  const miss = (lines) => { const l = lines.find((x) => x.includes("cache-misses")); return l ? l.split("#")[1].trim().split(/\s+/)[0] + "%" : "–"; };
  out.push(P("**Hardware counters.** `perf stat` over the whole program:"));
  out.push(Caption("Table 3. perf stat, whole program, N = 10,000,000 (verbatim counts).", true));
  out.push(Tbl(["Threads", "Instructions", "Cycles", "Instructions per cycle", "Cache-miss rate"], [
    [1, num(G1, "instructions"), num(G1, "cycles"), ipc(G1), miss(G1)],
    [16, num(G16, "instructions"), num(G16, "cycles"), ipc(G16), miss(G16)],
  ], [1100, 2200, 2200, 2000, 1860]), gap());
  out.push(P("The instruction counts are the same to within 0.1%, which again confirms that the work does not change. The instructions per cycle and the cache-miss rate are also the same, but that does not mean the parallel part has no memory contention: `perf` counted the whole program, and more than 90% of it is the single-threaded sequential sort and qsort. The per-level merge profile at the end of Task 2 isolates the parallel merges and does show them slowing down."));

  // H: input size sweep
  const Ns = [1000000, 10000000, 100000000];
  const amd = (n) => { const r1 = by("H", n, 1); const f = 2 * r1.seq_merge_mean / r1.seq_mean; return { f, s16: 1 / (f + (1 - f) / 16) }; };
  out.push(P("**Input size.** Task 3 predicts that the parallelism grows only like (lg N)/2, so a bigger input should help a little. I ran 1 and 16 threads on three sizes, 3 runs each:"));
  out.push(Caption("Table 4. Input-size sweep at 16 threads (mean of 3 runs, job 50358766).", true));
  out.push(Tbl(["N", "Sequential (s)", "Parallel, 16 threads (s)", "Speedup", "f = 2Tm/T1", "Amdahl S(16)", "(lg N)/2"],
    Ns.map((n) => { const r = by("H", n, 16), a = amd(n); return [n.toLocaleString("en-US"), f3(r.seq_mean), `${f3(r.par_mean)} ± ${f3(r.par_sd)}`, f2(r.speedup), f4(a.f), f2(a.s16), (Math.log2(n) / 2).toFixed(1)]; }),
    [1400, 1300, 1800, 1000, 1200, 1300, 1360]), gap());
  const big = by("F", 100000000, 16);
  out.push(P(`The predicted speedup grows slowly with N, from ${f2(amd(1000000).s16)} to ${f2(amd(100000000).s16)}. The measurements only partly follow it. At 1,000,000 elements the parallel sort takes only ${f3(by("H", 1000000, 16).par_mean)} s, so creating 31 threads and the uneven start of the leaf threads cost a larger share, and the speedup is lowest (${f2(by("H", 1000000, 16).speedup)}). At 100,000,000 the results vary a lot: the three runs averaged ${f2(by("H", 100000000, 16).speedup)}, but the run sampled by \`ps\` in the same job got ${f2(big.speedup)}. With two 800 MB arrays plus the 800 MB backup copy, this size depends heavily on memory bandwidth, which the node shares with other jobs. The cleaner comparison is the 50,000,000-element run in Table 7, where 16 threads gave 7.46 compared with 6.57 at 10,000,000, as predicted.`));
  return out;
};
