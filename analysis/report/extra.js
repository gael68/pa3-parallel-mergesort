// "Extra experiments" subsection of Task 2, built from the second and third jobs.
const fs = require("fs");
const path = require("path");

module.exports = (R) => {
  const { P, Img, Caption, Tbl, Bullet, Code, f2, f3, f4, A, B, D, prof, main, C, Tm, seqAll } = R;
  const out = [];
  const amdahl = (f, p) => 1 / (f + (1 - f) / p);
  const by = (rows, t) => rows.find((r) => r.threads === t);
  const runs = fs.readFileSync(path.join("/Users/gaels/workplace/osLabs/lab3/pa3/results", "runs.csv"), "utf8").trim().split("\n");
  const head = runs[0].split(",");
  const profRuns = runs.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v]))).filter((r) => r.profile === "True");
  const TmP = profRuns.reduce((a, r) => a + +r.seq_merge, 0) / profRuns.length;

  out.push(P("To check the conclusions above, a second job (50358714) ran on a 64-core RM-shared allocation (node r358, same AMD EPYC 7742 hardware). It ran four experiments; every run passed the same validation as the main job."));

  // A + B: more threads, bigger input
  const TB1 = B.reduce((a, r) => a + r.seq_mean * r.runs, 0) / B.reduce((a, r) => a + r.runs, 0);
  const TmB = B.reduce((a, r) => a + r.seq_merge_mean * r.runs, 0) / B.reduce((a, r) => a + r.runs, 0);
  const fB = 2 * TmB / TB1;
  out.push(P(`**More threads and a bigger input.** With N = 10,000,000 the speedup is ${f2(by(A, 32).speedup)} at 32 threads and ${f2(by(A, 64).speedup)} at 64, so it has nearly stopped growing, as Amdahl's Law predicts (limit ${C.Smax.toFixed(1)}). With N = 50,000,000 (sequential mergesort ${f2(TB1)} s, top-level merge ${f4(TmB)} s, so f = ${f4(fB)}), Amdahl predicts S(16) = ${f2(amdahl(fB, 16))} and S(64) = ${f2(amdahl(fB, 64))}; I measured ${f2(by(B, 16).speedup)} and ${f2(by(B, 64).speedup)}. The larger input has a smaller serial fraction because the merges are Θ(N) while the whole sort is Θ(N log N), so it scales a little further. This is the Θ(log N) parallelism from Task 3.`));
  out.push(Caption("Table 7. Speedup for the extra experiments (mean of 5 runs for A, 3 runs for B and D).", true));
  const ps = [1, 2, 4, 8, 16, 32, 64];
  const ten = (p) => by(main, p) || by(A, p);
  out.push(Tbl(["Threads", "N = 10M, -O0", "N = 50M, -O0", `Amdahl N = 50M (f = ${f3(fB)})`, "N = 10M, -O2"],
    ps.map((p) => [p, f2(ten(p).speedup), f2(by(B, p).speedup), f2(amdahl(fB, p)), f2(by(D, p).speedup)]),
    [1300, 1900, 1900, 2300, 1960]), R.gap());
  out.push(Img("fig4_extra.png", 6.0), Caption("Figure 4. Speedup up to 64 threads. The 1–16 thread points for N = 10M are from the main job; 32 and 64 are from the 64-core job."));

  // D: -O2
  const D1 = by(D, 1);
  out.push(P(`**Compiler optimization.** With \`-O2\` the sequential mergesort takes ${f3(D1.seq_mean)} s instead of ${f3(seqAll)} s and the top-level merge ${f4(D1.seq_merge_mean)} s instead of ${f4(Tm)} s. Both get about ${(seqAll / D1.seq_mean).toFixed(2)}× faster, so the serial fraction barely changes (2·Tm/T1 = ${f4(2 * D1.seq_merge_mean / D1.seq_mean)}) and neither does the speedup (${f2(by(D, 16).speedup)} at 16 threads). Optimization makes the program faster but not more parallel.`));

  // C: merge profile
  const lv = {};
  for (const q of prof.filter((q) => q.threads === 64)) {
    const top = 6;
    const k = top - q.level;
    (lv[k] = lv[k] || []).push(q.sec);
  }
  const rows = Object.keys(lv).map(Number).sort((a, b) => a - b).map((k) => {
    const mean = lv[k].reduce((a, b) => a + b, 0) / lv[k].length;
    const ideal = TmP / 2 ** k;
    return [k, `N/${2 ** k}`, lv[k].length / 3, f4(mean), f4(ideal), `${(100 * (mean / ideal - 1)).toFixed(0)}%`];
  });
  out.push(P("**Per-level merge times.** Building with `-DMERGE_PROFILE` makes every thread print how long its merge took. For 64 threads (THREAD_LEVEL 6) that is 63 merges per run on six levels. Table 8 compares them with the model from Task 2, which assumes a merge of N/2^k elements takes Tm/2^k."));
  out.push(Caption(`Table 8. Merge time per level, 64 threads, 3 runs (ideal uses Tm = ${f4(TmP)} s measured in the same runs).`, true));
  out.push(Tbl(["Level k", "Merge size", "Merges per run", "Measured mean (s)", "Ideal Tm/2^k (s)", "Slower by"], rows,
    [1100, 1400, 1500, 1800, 1800, 1760]), R.gap());
  out.push(Img("fig5_merge_levels.png", 6.0), Caption("Figure 5. Time of one merge at each level of the parallel run (log scale)."));
  out.push(P("Every level is slower than the model, by about 17% at the top and 22–33% below it. Two effects explain this. The merges on the same level run at the same time and share the memory bandwidth. And each merge reads data that other threads just wrote on other cores, so it misses in its own cache. This is the main reason the measured speedup falls below both models at 16 threads and above."));
  return out;
};
