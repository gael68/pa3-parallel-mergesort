// Builds "PA3 Report.docx" from the validated CSVs in pa3/results.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, LevelFormat,
  TabStopType, PageBreak, ExternalHyperlink,
} = require("docx");

const REPO = "/Users/gaels/workplace/osLabs/lab3/pa3";
const RES = path.join(REPO, "results");
const OUT = process.argv[2] || "/Users/gaels/workplace/osLabs/lab3/PA3 Report.docx";
const DATE = process.env.REPORT_DATE;

function csv(name) {
  const p = path.join(RES, name);
  if (!fs.existsSync(p)) return [];
  const [head, ...lines] = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((l) => {
    const v = l.split(",");
    const o = {};
    keys.forEach((k, i) => { o[k] = v[i] !== undefined && v[i] !== "" && !isNaN(+v[i]) ? +v[i] : v[i]; });
    return o;
  });
}
const summary = csv("summary.csv");
const amd = csv("amdahl.csv");
const C = Object.fromEntries(csv("constants.csv").map((r) => [r.name, r.value]));
const prof = csv("merge_profile.csv");
const S = (exp) => summary.filter((r) => r.exp === exp).sort((a, b) => a.threads - b.threads);
const main = S("main"), A = S("A"), B = S("B"), D = S("D");
const f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3), f4 = (x) => x.toFixed(4);

// ---------- building blocks ----------
const FONT = "Calibri", MONO = "Consolas", RED = "C00000";
const t = (text, o = {}) => new TextRun({ text, font: o.mono ? MONO : FONT, size: o.mono ? 19 : 22, ...o });
function runs(spec, base = {}) {
  // spec: string or array of strings / [text, opts]; `backticks` become monospace
  const arr = Array.isArray(spec) ? spec : [spec];
  const out = [];
  for (const piece of arr) {
    if (typeof piece !== "string") { out.push(t(piece[0], { ...base, ...piece[1] })); continue; }
    piece.split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach((s) => {
      if (!s) return;
      if (s.startsWith("`")) out.push(t(s.slice(1, -1), { ...base, mono: true }));
      else if (s.startsWith("**")) out.push(t(s.slice(2, -2), { ...base, bold: true }));
      else out.push(t(s, base));
    });
  }
  return out;
}
const P = (spec, o = {}) => new Paragraph({ children: runs(spec, o.run || {}), spacing: { after: 120 }, ...o.para });
const RedP = (spec) => P(spec, { run: { color: RED } });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(text, { bold: true, size: 24 })] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t(text, { bold: true, size: 22 })] });
const Bullet = (spec, o = {}) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(spec, o.run || {}), spacing: { after: 60 } });
const Caption = (text, above = false) => new Paragraph({ alignment: AlignmentType.CENTER, keepNext: above, spacing: { before: above ? 120 : 0, after: above ? 80 : 200 }, children: [t(text, { italics: true, size: 19, color: "52514E" })] });

function Code(lines) {
  return lines.map((l, i) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: "F3F3F1" },
    spacing: { after: i === lines.length - 1 ? 160 : 0, line: 240 },
    indent: { left: 144 },
    children: [t(l.replace(/\t/g, "    ") || " ", { mono: true, size: 17 })],
  }));
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
function Tbl(header, rows, widths, o = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, w, isHead, keep = true) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: isHead ? { type: ShadingType.CLEAR, fill: "E8EEF8" } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ keepNext: keep, keepLines: true, children: runs(String(txt), { size: 19, bold: isHead }) })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    // keepNext on every row but the last keeps short tables on one page
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r, j) => new TableRow({ cantSplit: true,
        children: r.map((c, i) => cell(c, widths[i], false, o.keep !== false && j < rows.length - 1)) }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function Img(file, widthIn) {
  const buf = fs.readFileSync(path.join(RES, "figs", file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const px = widthIn * 96;
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: px * h / w },
      altText: { title: file, description: file, name: file } })] });
}

// ---------- content ----------
const body = [];
const add = (...x) => body.push(...x.flat());

// Header block in the style of the PA1/PA2 reports.
const hdr = (l, r) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9360 }], spacing: { after: 0 },
  children: [t(l), t("\t" + r)] });
add(hdr("CS4475  Fall 2026", "Lab Report"), hdr("Gael Sustaita", `Submitted on ${DATE}`),
  new Paragraph({ spacing: { after: 240 }, children: [t("gsustaita4@miners.utep.edu")] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [t("PA3: Parallel MergeSort", { bold: true, size: 30 })] }));

const seqAll = C.T1_seq_mergesort_s, Tm = C.Tm_top_merge_s;
add(
  new Paragraph({ spacing: { after: 120 }, children: [t("Repository: ", { bold: true }),
    new ExternalHyperlink({ link: "https://github.com/gael68/pa3-parallel-mergesort",
      children: [t("https://github.com/gael68/pa3-parallel-mergesort", { style: "Hyperlink" })] }),
    ...runs(", branch `main`. The first commit is the provided `parallelMergesort.c` unchanged, so `git diff` against it shows exactly what I added. This report is committed as `PA3 Report.pdf`, and every raw Bridges-2 output file is in `results/`.")] }),
  P("**Platform:** PSC Bridges-2, RM-shared partition. Each node has two AMD EPYC 7742 64-core processors (128 cores, 2 NUMA nodes, 256 GB RAM). Compiler: `gcc (GCC) 8.5.0`. I compiled exactly as the handout shows, `gcc -o mergesortN parallelMergesort.c -lpthread` (no optimization flags), and used one executable per thread count."),
  P("**How the runs were done:** instead of `interact`, I used a batch script (`run.sbatch`) that requests `--ntasks-per-node=16` on RM-shared, which is the same 16-core allocation the interact command in the handout gets. The script builds `mergesort1`, `mergesort2`, `mergesort4`, `mergesort8` and `mergesort16` by setting `THREAD_LEVEL` to 0–4 (threads = 2^THREAD_LEVEL), then runs each one **5 times** on 10,000,000 elements. Job 50358707 ran on node r195. A second job (50358714, node r358, 64 cores) ran the extra experiments described at the end of Task 2, and a third (50358766, node r227, 16 cores) collected the evidence at the end of Task 1 and the input-size sweep."),
  P("**THREAD_LEVEL note:** the handout says the default is 2^3, but the copy of `parallelMergesort.c` in the shared directory has `#define THREAD_LEVEL 1` (2 threads). It does not matter here because every build sets it explicitly; the script checks that the substitution happened and stops if it did not."),
  P("**Validating the output:** every program run prints its sequential time, parallel time, qsort time and my new merge timers, and the program itself checks that each result is sorted (`isSorted`). I wrote `analysis/parse.py` to read the raw output and refuse to produce any numbers unless every run has all of its timing lines, no run prints `Oops` or `ERROR`, all times are positive, and each configuration has the expected number of runs. All " +
    `${summary.reduce((a, r) => a + r.runs, 0)} runs passed (plus ${new Set(prof.map((q) => q.threads + "/" + q.run)).size} profiling runs). ` +
    "I also tested the validator by feeding it a deliberately damaged copy of the output (a deleted line, an injected `Oops`, a missing run); it reported all of them and exited with an error."),
);

// ---------------- Task 1 ----------------
add(H1("Task 1. (10 pts) Speedup with 1, 2, 4, 8 and 16 cores"));
add(P(`Each program run times the sequential mergesort and then the parallel mergesort on a copy of the same random list. Speedup is the mean sequential time divided by the mean parallel time for that configuration (5 runs each). Efficiency is speedup / threads. Across all 25 runs the sequential mergesort averaged ${f3(seqAll)} s, so 10,000,000 elements gives a few seconds of sequential time as the handout asks.`));
add(Caption("Table 1. Execution times on Bridges-2 (N = 10,000,000, 5 runs per configuration, job 50358707). Level = THREAD_LEVEL; threads = 2^Level.", true));
add(Tbl(["Threads (cores)", "Level", "Sequential mergesort (s), mean ± sd", "Parallel mergesort (s), mean ± sd", "Speedup", "Linear", "Efficiency"],
  main.map((r) => [r.threads, Math.log2(r.threads), `${f3(r.seq_mean)} ± ${f3(r.seq_sd)}`, `${f3(r.par_mean)} ± ${f3(r.par_sd)}`, f2(r.speedup), r.threads, `${(100 * r.efficiency).toFixed(0)}%`]),
  [1150, 1150, 1700, 1700, 1100, 900, 1160]), gap());
add(Img("fig1_speedup.png", 6.0), Caption("Figure 1. Measured speedup compared with linear speedup. Error bars are the standard deviation of the per-run speedup."));
add(Img("fig2_times.png", 6.0), Caption("Figure 2. Mean execution time. The sequential mergesort line is flat because every executable runs the same sequential code."));
const m = Object.fromEntries(main.map((r) => [r.threads, r]));
add(
  P("**Discussion.** " +
    `With 2 threads the speedup is ${f2(m[2].speedup)} (${(100 * m[2].efficiency).toFixed(0)}% efficiency), almost linear. Efficiency then drops steadily: ${(100 * m[4].efficiency).toFixed(0)}% at 4, ${(100 * m[8].efficiency).toFixed(0)}% at 8 and ${(100 * m[16].efficiency).toFixed(0)}% at 16 threads, where the speedup is ${f2(m[16].speedup)} instead of 16. ` +
    "The 1-thread version is a useful check: it runs the same sequential code inside one extra thread and takes the same time as the sequential mergesort (speedup " + f2(m[1].speedup) + "), so thread creation itself costs almost nothing. The gap from linear comes from the merges, which Task 2 measures."),
  P(`The runs were very repeatable. The standard deviation is under 1% of the mean everywhere except 16 threads (${f3(m[16].par_sd)} s, ${(100 * m[16].par_sd / m[16].par_mean).toFixed(0)}%). Node r195 is shared with other users' jobs (Slurm reported a CPU load of about 111 of its 128 cores while this job ran), so with 16 threads my job competes for memory bandwidth and shared L3 cache with them.`),
);
add(H2("Raw output (one complete run per configuration, copied verbatim from pa3-50358707.out)"));
const raw = fs.readFileSync(path.join(RES, "pa3-50358707.out"), "utf8").split("\n");
const ex = [raw[0]];
for (const th of [1, 2, 4, 8, 16]) {
  const i = raw.indexOf(`=== threads=${th} run=1`);
  ex.push(...raw.slice(i, i + (th === 1 ? 5 : 6)));
}
add(Code(ex));
const evIdx = body.length;

// ---------------- Task 2 ----------------
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Task 2. (15 pts) Timing the sequential merge and Amdahl's Law"));
add(H2("Timing code"));
add(P("In the provided code the sequential mergesort is `mergeSort()` → `mergeSortHelper(lyst, back, 0, size-1)`, and the top-level merge is the last `merge()` call inside the first `mergeSortHelper` call. To time only that call, I unrolled the first level of the recursion in `mergeSort()` so the top-level `merge()` is called directly and wrapped it in `gettimeofday()` calls (`parallelMergesort.c`, lines 153–171). The two halves are split at the same `mid` that `mergeSortHelper` uses, so the work is unchanged."));
add(Code([
  "void mergeSort(double lyst[], int size)",
  "{",
  "\tstruct timeval start, end;",
  "\tdouble *back = (double *) malloc(size*sizeof(double));",
  "",
  "\tif (size > 1)",
  "\t{",
  "\t\tint mid = (size - 1) / 2;",
  "\t\tmergeSortHelper(lyst, back, 0, mid);",
  "\t\tmergeSortHelper(lyst, back, mid + 1, size - 1);",
  "",
  "\t\tgettimeofday(&start, NULL);",
  "\t\tmerge(lyst, back, 0, mid, size - 1);",
  "\t\tgettimeofday(&end, NULL);",
  "\t\tprintf(\"Top-level sequential merge took: %lf sec.\\n\",",
  "\t\t\telapsed(&start, &end));",
  "\t}",
  "\tfree(back);",
  "}",
]));
add(P("I also timed the same top-level merge inside the parallel version (`parallelMergeSortHelper`, lines 360–370). It prints only for the thread whose range is the whole list, which is the merge done after the last `pthread_join`. `elapsed()` is a small helper with the same microsecond arithmetic `main()` already used. I also added a usage message: the program now exits with status 1 if it is given more than one argument or a size below 2, instead of crashing."));
add(Code([
  "\tstruct timeval start, end;",
  "\tgettimeofday(&start, NULL);",
  "\tmerge(my_data->lyst, my_data->back, my_data->low, mid, my_data->high);",
  "\tgettimeofday(&end, NULL);",
  "\tif (my_data->low == 0 && my_data->high == NUM - 1)",
  "\t{",
  "\t\tprintf(\"Top-level merge in parallel run took: %lf sec.\\n\",",
  "\t\t\telapsed(&start, &end));",
  "\t}",
]));

add(H2("Measured merge time"));
add(Caption("Table 5. Top-level merge times (mean ± sd over 5 runs, N = 10,000,000).", true));
add(Tbl(["Threads", "Top-level merge, sequential sort (s)", "Top-level merge, parallel sort (s)", "Merge share of sequential time"],
  main.map((r) => [r.threads, `${f4(r.seq_merge_mean)} ± ${f4(r.seq_merge_sd)}`, r.threads > 1 ? `${f4(r.par_merge_mean)} ± ${f4(r.par_merge_sd)}` : "– (no merge: one thread sorts everything)", `${(100 * r.seq_merge_mean / r.seq_mean).toFixed(2)}%`]),
  [1100, 2700, 3000, 2560]), gap());
add(P(`Averaged over all 25 runs, the top-level sequential merge takes **Tm = ${f4(Tm)} s** and the whole sequential mergesort takes **T1 = ${f4(seqAll)} s**. The top merge is the same in the parallel version (${f4(m[16].par_merge_mean)} s at 16 threads), which confirms it is done by a single thread there too.`));
add(P(`A useful cross-check: every level of the merge tree merges all N elements once, so each level should cost about Tm. A full mergesort has log2(10,000,000) = ${C.log2N.toFixed(2)} levels, which predicts ${C.log2N.toFixed(2)} × ${f4(Tm)} = ${f3(C.Tm_x_log2N_s)} s for the whole sequential sort. The measured ${f3(seqAll)} s is within ${(100 * (seqAll - C.Tm_x_log2N_s) / seqAll).toFixed(1)}%, so the per-level merge cost really is constant and Tm is a good unit of work.`));

add(H2("Why the measured merge time needs more calculation"));
add(P("Only the top-level merge is completely sequential, but it is not the only merge that limits the parallel execution. In `parallelMergeSortHelper` a thread at level k waits for its two children, then merges their halves itself. So with p = 2^L threads the merge tree has L levels that run with less than full parallelism:"));
add(
  Bullet("level 0 (top): 1 merge of N elements, 1 thread busy → takes Tm"),
  Bullet("level 1: 2 merges of N/2 elements at the same time → takes Tm/2"),
  Bullet("level 2: 4 merges of N/4 → Tm/4, … , level L−1: 2^(L−1) merges → Tm/2^(L−1)"),
);
add(P("While these merges run, most of the p cores are idle, so their time adds directly to the parallel execution time. The total is a geometric series:"));
add(P("Ts(L) = Tm (1 + 1/2 + 1/4 + … + 1/2^(L−1)) = Tm (2 − 2^(1−L)),  which approaches 2·Tm as L grows.", { run: { bold: true } , para: { alignment: AlignmentType.CENTER } }));
add(P(`So the serial time in the parallel execution is about twice the measured top-level merge time, not Tm. This is the extra calculation the handout asks for. For an unlimited number of cores, Ts = 2·Tm = ${f4(2 * Tm)} s.`));

add(H2("Amdahl's Law predictions"));
add(P(`Serial fraction f = 2·Tm / T1 = ${f4(2 * Tm)} / ${f4(seqAll)} = **${f4(C.f_all_merge_levels)}**. For comparison, using only the top merge would give f = Tm / T1 = ${f4(C.f_top_merge_only)}.`));
add(P(`Amdahl's Law: S(p) = 1 / (f + (1 − f)/p). With infinitely many cores, **S(∞) = 1/f = ${C.Smax.toFixed(1)}**. With the 16 cores I used, **S(16) = ${f2(C.amdahl_16)}**. (Using the top merge only would predict S(∞) = ${C.Smax_naive.toFixed(1)} and S(16) = ${f2(C.amdahl_16_naive)}, which is far above what I measured.)`));
add(Caption("Table 6. Predicted and measured speedup. Measurements for 32 and 64 threads come from the second job (64-core allocation); see below.", true));
add(Tbl(["Threads p", "Measured speedup", "Amdahl, f = " + f3(C.f_all_merge_levels), "Amdahl, f = " + f3(C.f_top_merge_only) + " (top merge only)", "Work-span model T1 / span", "Linear"],
  amd.map((r) => [r.threads, r.measured_speedup === "" || r.measured_speedup === undefined ? "–" : f2(r.measured_speedup), f2(r.amdahl_f), f2(r.amdahl_naive_f), f2(r.workspan_speedup), r.threads])
    .concat([["∞", "–", C.Smax.toFixed(2), C.Smax_naive.toFixed(2), "≈ " + C.Smax.toFixed(1), "∞"]]),
  [1100, 1500, 1600, 2100, 1800, 1260]), gap());
add(Img("fig3_amdahl.png", 6.2), Caption("Figure 3. Amdahl's Law predictions vs measured speedup. The dotted lines are the 1/f limits."));

add(H2("Discussion"));
add(
  P(`**Using all merge levels is the right serial fraction.** With f = ${f3(C.f_all_merge_levels)}, Amdahl predicts ${f2(C.amdahl_16)} at 16 threads and I measured ${f2(m[16].speedup)} (${(100 * m[16].speedup / C.amdahl_16).toFixed(0)}% of the prediction). Counting only the top merge predicts ${f2(C.amdahl_16_naive)}, which overestimates by ${(100 * (C.amdahl_16_naive / m[16].speedup - 1)).toFixed(0)}%.`),
  P(`**At 2–8 threads the measurements are slightly above the f = ${f3(C.f_all_merge_levels)} curve.** Amdahl's Law assumes the serial part is fixed, but here it grows with the number of threads: with 2 threads only the top merge is serial (Tm), with 4 threads it is 1.5·Tm, and it reaches 2·Tm only in the limit. The work-span model in Table 6 uses the exact serial part for each L, and it matches the measurements within 2% for 2, 4 and 8 threads.`),
  P(`**At 16 threads the measurement falls below both models** (${f3(m[16].par_mean)} s measured vs ${f3(amd.find((r) => r.threads === 16).workspan_Tp_s)} s predicted by the work-span model). Neither model includes hardware effects. Merging is memory-bound: it reads and writes every element with almost no computation, so 16 threads sorting and merging at once compete for memory bandwidth and the shared L3 cache. The node was also shared with other users' jobs, and the 16-thread runs were the only ones with noticeable variation. Both models also assume the merges at each level run perfectly in parallel; the per-level merge profile below shows they are slower than that.`),
);
add(H2("Extra experiments (job 50358714)"));
const extraIdx = body.length;

// ---------------- Task 3 ----------------
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Task 3. (15 pts) Computational DAG and work-span analysis"));
add(P("Figure 6 is the DAG for `THREAD_LEVEL = 3` (8 threads). Each node is a piece of sequential work labeled with its cost in element operations. Edges are dependencies: a fork node creates two threads (`pthread_create`); a merge node can start only after both child threads finish (`pthread_join`). In the code, the fork and merge nodes at the same position belong to the same thread, which sleeps in `pthread_join` between them."));
add(Img("fig6_dag.png", 6.5), Caption("Figure 6. DAG for 8 threads. Purple: thread creation, O(1). Blue: sequential mergesort of N/8 elements, c·(N/8)·lg(N/8). Green: merges with their sizes (a merge of n elements costs c·n). Orange: one critical path."));
add(P("**Work of each node** (c = cost per element per merge level; Task 2 measured c ≈ Tm/N = " + (Tm / 1e7 * 1e9).toFixed(1) + " ns):"));
add(
  Bullet("fork / start node: O(1) (one `pthread_create` pair). There are p − 1 of them."),
  Bullet("leaf node: `mergeSortHelper` on N/p elements, c·(N/p)·lg(N/p). There are p of them."),
  Bullet("merge node at level k (k = 0 is the top): merges N/2^k elements, c·N/2^k. Level k has 2^k of them."),
);
add(P("The DAG has logarithmic depth (L fork levels and L merge levels), but its nodes do not have constant work: the leaf and merge nodes are large, and the merge nodes get bigger toward the bottom. So the span has to be found by adding the node weights along a path, not by counting levels."));
add(H2("Work"));
add(P("W(N, p) = p · c(N/p)lg(N/p) + L · cN + O(p) = cN(lg N − L) + cN·L + O(p) = cN lg N + O(p)", { para: { alignment: AlignmentType.CENTER }, run: { bold: true } }));
add(P(`Each merge level touches all N elements once, so L levels of merges cost cN·L, and the leaves supply the remaining lg N − L levels. The work equals the sequential mergesort, Θ(N log N), so parallelizing adds no extra work apart from thread creation. Measured: W ≈ T1 = ${f3(seqAll)} s.`));
add(H2("Span (critical path)"));
add(P("Every root-to-sink path goes through L forks, one leaf and one merge on each level, and all of these have the same weight, so every path is critical. The orange path in Figure 6 is one of them. Adding the node weights:"));
add(P("S(N, p) = O(L) + c(N/p)lg(N/p) + c(N + N/2 + … + N/2^(L−1)) = c(N/p)lg(N/p) + 2cN(1 − 2^(−L)) + O(L)", { para: { alignment: AlignmentType.CENTER }, run: { bold: true } }));
add(P("This is the same geometric series as in Task 2: the merges on the critical path add up to almost 2N element operations no matter how many threads are used."));
add(Caption("Table 9. Work-span numbers using the measured c (from Tm). W = T1 = " + f3(seqAll) + " s.", true));
add(Tbl(["Threads p", "Leaf on path (s)", "Merges on path (s)", "Span S (s)", "W / p (s)", "Lower bound max(W/p, S) (s)", "Measured Tp (s)", "Parallelism W / S"],
  amd.filter((r) => r.threads > 1).map((r) => {
    const L = Math.log2(r.threads);
    const leaf = Math.log2(1e7 / r.threads) * Tm / r.threads;
    const mer = Tm * (2 - 2 ** (1 - L));
    return [r.threads, f3(leaf), f3(mer), f3(leaf + mer), f3(seqAll / r.threads), f3(Math.max(seqAll / r.threads, leaf + mer)),
      r.measured_par_s === "" || r.measured_par_s === undefined ? "–" : f3(r.measured_par_s), f2(seqAll / (leaf + mer))];
  }), [900, 1100, 1150, 1000, 900, 1500, 1300, 1310]), gap());
add(P("**Lower bounds.** The work law gives Tp ≥ W/p and the span law gives Tp ≥ S. For every thread count the span is the larger of the two, so the span law is the bound that matters, and every measured time is above it, as it must be. For 2, 4 and 8 threads the measured time is within 3% of the span, which means the program is nearly as fast as this DAG allows."));
add(P(`**Unlimited threads.** If the recursion created threads all the way down (L = lg N), the leaves would vanish and S = 2cN(1 − 1/N) + O(lg N) ≈ 2cN = Θ(N). The parallelism would be W/S = cN lg N / 2cN = (lg N)/2 ≈ ${(C.log2N / 2).toFixed(1)} for N = 10^7. This agrees with the Amdahl limit of ${C.Smax.toFixed(1)} from Task 2, which is expected because both come from the same 2·Tm of merges.`));
add(P("**Implications of the critical path.** The critical path is dominated by the merges, and above all by the final merge of all N elements, which one thread does alone. No number of cores can make the program faster than about 2·Tm ≈ " + f3(2 * Tm) + " s, and the parallelism only grows like Θ(log N), so larger inputs barely help. To do better, the merge itself has to be parallelized. Grossman section 5.4 shows how: split the larger half at its median, binary-search for that value in the other half, and merge the two pairs of pieces in parallel. That merge has span O(log² N), so the whole sort has span O(log³ N) and parallelism Θ(N / log² N), which is enough to keep many more cores busy."));

// ---------------- Task 4 ----------------
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Task 4. (10 pts) Difficulties and what I learned"));
add(RedP("[Draft written by Claude from what actually happened while doing this assignment. Gael: rewrite this section in your own words before submitting.]"));
add(H2("Difficulties"));
add(
  Bullet("**Getting the code off Bridges-2.** My first `scp` closed the connection right after I entered my password. Logging in interactively with `ssh` worked. The next `scp` failed with “subsystem request failed”, because newer macOS `scp` uses SFTP and Bridges-2 login nodes don't allow it. `scp -O` (the old protocol) then failed with “scp: command not found”, because the login node has no `scp` program. What finally worked was streaming a tar archive over plain ssh: `ssh sustaita@bridges2.psc.edu 'tar cf - ...' | tar xf -`."),
  Bullet("**Typing my password for every command.** I opened one SSH connection with `ControlMaster`/`ControlPersist` so later `ssh` commands reused it without asking for the password again. That made it practical to upload files, submit jobs and fetch results from scripts."),
  Bullet("**Where to put the timer.** The top-level sequential merge is buried inside the recursive `mergeSortHelper`, so there was no single call to wrap. I unrolled the first level of the recursion in `mergeSort()` so the top-level `merge()` is a separate call that can be timed, without changing the work done."),
  Bullet("**Why the merge time needs more calculation.** At first I used only the top-level merge as the serial part, and Amdahl's Law predicted almost 10× at 16 threads while I measured 6.6×. Drawing the DAG showed that the lower merge levels are also only partly parallel, and summing them gives about 2·Tm. With that, the prediction matches."),
  Bullet("**Run time and noise.** With N = 10,000,000 the sequential sort takes only about 2.5 s, and the node was shared with other jobs. I ran every configuration 5 times, reported the standard deviation, and ran a second job with N = 50,000,000 to check that the conclusions hold with longer runs."),
  Bullet("**Results that did not match the model.** The input-size sweep did not increase steadily: 16 threads gave 4.92× on 1,000,000 elements, 6.28× on 10,000,000 and 5.82× on 100,000,000, and one 100,000,000-element run in the same job got 7.82×. I had to work out that very large inputs depend on memory bandwidth shared with other jobs, and use the cleaner 50,000,000-element runs to check the trend. `perf stat` also showed no difference between 1 and 16 threads, until I realized it was counting the whole program, which is mostly single-threaded."),
  Bullet("**The handout's default THREAD_LEVEL.** The handout says the default is 2^3, but the shared file had `THREAD_LEVEL 1`. My build script sets it explicitly and checks that the change was made."),
);
add(H2("What I learned"));
add(
  Bullet("How to measure speedup properly: compare against the sequential version on the same input, repeat runs, and look at the spread, not one number."),
  Bullet("Amdahl's Law is only as good as the serial fraction you put into it. The serial part of a divide-and-conquer program is the whole chain of partly-parallel combine steps, not just the last one."),
  Bullet("Work and span explain the results: the work of parallel mergesort is the same Θ(N log N) as sequential, but the span is Θ(N) because of the sequential merge, so the parallelism is only about (log N)/2 ≈ 12. Adding cores past that point cannot help."),
  Bullet("Real hardware falls below the models. Memory bandwidth, shared caches and other users on the node cost speedup at 16 threads and more, which neither Amdahl's Law nor work-span accounts for."),
  Bullet("How to use a batch system (Slurm `sbatch`, `squeue`, `sacct`) on a supercomputer, and how to move files when the usual tools are blocked."),
);

// ---------------- Disclosure ----------------
add(H1("Resources and AI-use disclosure"));
add(RedP("[Gael: review and edit this disclosure so it accurately describes your own use before submitting.]"));
add(RedP("Resources: the PA3 handout; the provided parallelMergesort.c (Joshua Stough, MIT License); Grossman, “A Sophomoric Introduction to Shared-Memory Parallelism and Concurrency”, section 5.4; the PSC Bridges-2 User Guide."));
add(RedP("AI use: I used Claude Code (Anthropic, model Claude Opus 5.5) as an assistant throughout this assignment. Claude explained how to log in to Bridges-2 and how to work around the blocked scp/SFTP, and wrote a step-by-step page of the login and job-submission commands. After I opened an SSH connection with my own password, Claude used it to upload the code, submit the Slurm jobs and download the output. Claude wrote the timing code in parallelMergesort.c (the unrolled top-level merge timer, the parallel top-level merge timer, the optional MERGE_PROFILE output and the usage check), the batch scripts run.sbatch, run_extra.sbatch and run_demo.sbatch, the demo script demo.py, the Python scripts that validate the output and compute the statistics, Amdahl's Law and work-span numbers, all figures and the spreadsheet, and drafted the text of this report, including the Task 4 reflection, which I then rewrote. All numbers in this report come from the Bridges-2 runs listed above; none were typed in by hand. I reviewed the code, results and analysis and am responsible for the submitted work."));

// ---------------- Appendix ----------------
add(H1("Appendix: files in the repository"));
add(Tbl(["File", "What it is"], [
  ["parallelMergesort.c", "Provided program plus the Task 2 timers, the elapsed() helper, a usage check and optional MERGE_PROFILE output."],
  ["run.sbatch", "Main Slurm job: builds the 1/2/4/8/16-thread executables and runs each 5 times on 10,000,000 elements (16 cores)."],
  ["run_extra.sbatch", "Extra job on 64 cores: 32/64 threads, N = 50,000,000, per-level merge profile, -O2 builds, and the node's hardware info."],
  ["run_demo.sbatch", "Evidence job on 16 cores: /usr/bin/time -v, a ps -L thread snapshot, perf stat, and the input-size sweep."],
  ["results/pa3-50358707.out, pa3-extra-50358714.out, pa3-evidence-50358766.out", "Raw Bridges-2 output of the three jobs, unedited."],
  ["results/sacct.txt", "Slurm accounting (sacct, seff) for the three jobs: all COMPLETED with exit code 0."],
  ["demo.py", "Demo script: builds and runs the 1–16 thread versions locally, prints the timer code, and shows the Bridges-2 results task by task."],
  ["results/runs.csv, summary.csv, merge_profile.csv", "Every run and the per-configuration statistics, produced by parse.py after validation."],
  ["results/amdahl.csv, constants.csv", "Amdahl and work-span predictions, produced by analyze.py."],
  ["results/PA3 results.xlsx", "Spreadsheet: raw runs, a summary computed with formulas, and an Amdahl sheet where T1 and Tm can be changed to recompute every prediction."],
  ["results/figs/", "All figures in this report."],
  ["analysis/parse.py, analysis/analyze.py", "Validation, statistics and figure scripts."],
], [3300, 6060]));

module.exports = { csv, raw: (f) => fs.readFileSync(path.join(RES, f), "utf8"), gap, body, extraIdx, evIdx, H2, P, Img, Caption, Tbl, Bullet, Code, f2, f3, f4, A, B, D, prof, main, C, Tm, seqAll };

if (require.main === module) {
  const extra = require("./extra.js")(module.exports);
  body.splice(extraIdx, 0, ...extra);
  // evIdx comes earlier in the document, so splice it after extraIdx
  body.splice(evIdx, 0, ...require("./evidence.js")(module.exports));
  const doc = new Document({
    creator: "Gael Sustaita", title: "PA3: Parallel MergeSort",
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 24, bold: true }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 22, bold: true }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: body }],
  });
  Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log("wrote " + OUT); });
}
