"""Amdahl / work-span analysis, figures and spreadsheet from results/*.csv.

usage: python3 analyze.py        (run parse.py first)

Model (all from the main 10M-element, -O0 runs):
  T1  = mean sequential mergesort time
  Tm  = mean top-level merge time; one merge level over all N elements
  With p = 2^L threads, merge level k (k = 0 is the top) runs 2^k merges
  of N/2^k elements at once, so it takes Tm/2^k when k < L. Those levels
  form the serial part:  Ts(L) = Tm * (2 - 2^(1-L)),  Ts -> 2*Tm.
"""
import csv
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference, ScatterChart, Series
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "results"
FIGS = RES / "figs"
N = 10_000_000

# Validated categorical slots (blue, orange, aqua, violet) plus chart chrome.
BLUE, ORANGE, AQUA, VIOLET = "#2a78d6", "#eb6834", "#1baf7a", "#6250d6"
INK, INK2, MUTED, GRID, AXIS = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
SURFACE = "#fcfcfb"


def load(name):
    p = RES / name
    if not p.exists():
        return []
    with open(p) as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k, v in r.items():
            try:
                r[k] = float(v) if "." in v or "e" in v else int(v)
            except (ValueError, TypeError):
                pass
    return rows


def style(ax, title, xlabel, ylabel):
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", fontsize=12, color=INK, pad=10)
    ax.set_xlabel(xlabel, color=INK2)
    ax.set_ylabel(ylabel, color=INK2)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)
    for s in ["left", "bottom"]:
        ax.spines[s].set_color(AXIS)
    ax.tick_params(colors=INK2)


def log2_axis(ax, ps):
    ax.set_xscale("log", base=2)
    ax.set_xticks(ps)
    ax.set_xticklabels([str(p) for p in ps])
    ax.minorticks_off()


def save(fig, name):
    FIGS.mkdir(parents=True, exist_ok=True)
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout()
    fig.savefig(FIGS / name, dpi=200)
    plt.close(fig)


def amdahl(f, p):
    return 1.0 / (f + (1 - f) / p)


def model(T1, Tm, p):
    """Work-span model: leaves sort N/p each in parallel, then L merge levels."""
    L = int(math.log2(p))
    leaf = (math.log2(N / p)) * Tm / p
    serial = Tm * (2 - 2 ** (1 - L)) if L > 0 else 0.0
    return leaf + serial, leaf, serial


def main():
    runs = load("runs.csv")
    summary = load("summary.csv")
    prof = load("merge_profile.csv")
    main_runs = [r for r in runs if r["exp"] == "main"]
    T1 = sum(r["seq"] for r in main_runs) / len(main_runs)
    Tm = sum(r["seq_merge"] for r in main_runs) / len(main_runs)
    f_naive = Tm / T1
    f = 2 * Tm / T1
    levels_seq = math.log2(N)

    main = sorted([s for s in summary if s["exp"] == "main"], key=lambda s: s["threads"])
    ext10 = main + sorted([s for s in summary if s["exp"] == "A"], key=lambda s: s["threads"])
    big = sorted([s for s in summary if s["exp"] == "B"], key=lambda s: s["threads"])
    opt = sorted([s for s in summary if s["exp"] == "D"], key=lambda s: s["threads"])

    # ---- tables written for the report ----
    am_rows = []
    for p in [1, 2, 4, 8, 16, 32, 64]:
        meas = next((s for s in ext10 if s["threads"] == p), None)
        tp, leaf, serial = model(T1, Tm, p)
        am_rows.append({
            "threads": p,
            "measured_speedup": round(meas["speedup"], 3) if meas else "",
            "measured_par_s": round(meas["par_mean"], 4) if meas else "",
            "amdahl_naive_f": round(amdahl(f_naive, p), 3),
            "amdahl_f": round(amdahl(f, p), 3),
            "linear": p,
            "workspan_Tp_s": round(tp, 4),
            "workspan_speedup": round(T1 / tp, 3),
            "lower_bound_s": round(max(T1 / p, tp), 4),
            "bound_holds": (meas["par_mean"] >= max(T1 / p, tp) * 0.98) if meas else "",
        })
    with open(RES / "amdahl.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(am_rows[0]))
        w.writeheader()
        w.writerows(am_rows)

    consts = {
        "T1_seq_mergesort_s": T1, "Tm_top_merge_s": Tm,
        "log2N": levels_seq, "Tm_x_log2N_s": Tm * levels_seq,
        "f_top_merge_only": f_naive, "f_all_merge_levels": f,
        "Smax_naive": 1 / f_naive, "Smax": 1 / f,
        "amdahl_16_naive": amdahl(f_naive, 16), "amdahl_16": amdahl(f, 16),
    }
    with open(RES / "constants.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "value"])
        for k, v in consts.items():
            w.writerow([k, f"{v:.6g}"])
    for k, v in consts.items():
        print(f"{k:22s} {v:.4f}")

    # ---- Figure 1: measured speedup vs linear (Task 1) ----
    ps = [s["threads"] for s in main]
    sp = [s["speedup"] for s in main]
    sd = [s["speedup_paired_sd"] for s in main]
    fig, ax = plt.subplots(figsize=(7, 4.4))
    style(ax, "Speedup vs linear, N = 10,000,000 (Bridges-2, 16 cores)",
          "Threads (= cores)", "Speedup over sequential mergesort")
    log2_axis(ax, ps)
    ax.plot(ps, ps, color=MUTED, linestyle="--", linewidth=2, label="Linear (ideal)")
    ax.errorbar(ps, sp, yerr=sd, color=BLUE, linewidth=2, marker="o", markersize=7,
                capsize=3, label="Measured (mean of 5 runs)")
    for p, s in zip(ps, sp):
        ax.annotate(f"{s:.2f}", (p, s), textcoords="offset points", xytext=(0, -16),
                    ha="center", color=INK, fontsize=9)
    ax.set_ylim(0, 17)
    ax.legend(frameon=False, loc="upper left", labelcolor=INK)
    save(fig, "fig1_speedup.png")

    # ---- Figure 2: execution time ----
    fig, ax = plt.subplots(figsize=(7, 4.0))
    style(ax, "Mean execution time, N = 10,000,000", "Threads", "Time (s)")
    log2_axis(ax, ps)
    ax.errorbar(ps, [s["seq_mean"] for s in main], yerr=[s["seq_sd"] for s in main],
                color=ORANGE, marker="s", markersize=7, linewidth=2, capsize=3,
                label="Sequential mergesort (same binary)")
    ax.errorbar(ps, [s["par_mean"] for s in main], yerr=[s["par_sd"] for s in main],
                color=BLUE, marker="o", markersize=7, linewidth=2, capsize=3,
                label="Parallel mergesort")
    for s in main:
        ax.annotate(f"{s['par_mean']:.3f}", (s["threads"], s["par_mean"]),
                    textcoords="offset points", xytext=(6, 6), color=INK, fontsize=9)
    ax.set_ylim(0, 2.9)
    ax.legend(frameon=False, loc="center right", labelcolor=INK)
    save(fig, "fig2_times.png")

    # ---- Figure 3: Amdahl predictions vs measured (Task 2) ----
    pa = [r["threads"] for r in am_rows if r["measured_speedup"] != ""]
    fig, ax = plt.subplots(figsize=(7.4, 4.8))
    style(ax, "Amdahl's Law prediction vs measured speedup", "Threads (= cores)", "Speedup")
    allp = [r["threads"] for r in am_rows]
    log2_axis(ax, allp)
    ax.plot(allp, [amdahl(f_naive, p) for p in allp], color=VIOLET, marker="^", markersize=8,
            linewidth=2, label=f"Amdahl, top merge only (f = {f_naive:.3f})")
    ax.plot(allp, [amdahl(f, p) for p in allp], color=ORANGE, marker="s", markersize=7,
            linewidth=2, label=f"Amdahl, all merge levels (f = {f:.3f})")
    ax.plot(allp, [r["workspan_speedup"] for r in am_rows], color=AQUA, marker="D",
            markersize=6, linewidth=2, label="Work-span model T1 / span")
    ax.plot(pa, [r["measured_speedup"] for r in am_rows if r["measured_speedup"] != ""],
            color=BLUE, marker="o", markersize=8, linewidth=2.5, label="Measured")
    ax.axhline(1 / f, color=ORANGE, linestyle=":", linewidth=1.5)
    ax.annotate(f"limit 1/f = {1 / f:.1f}", (1, 1 / f), textcoords="offset points",
                xytext=(4, 4), color=INK2, fontsize=9)
    ax.axhline(1 / f_naive, color=VIOLET, linestyle=":", linewidth=1.5)
    ax.annotate(f"limit 1/f = {1 / f_naive:.1f}", (1, 1 / f_naive), textcoords="offset points",
                xytext=(4, 4), color=INK2, fontsize=9)
    ax.set_ylim(0, 25)
    ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(0.0, 0.9), labelcolor=INK, fontsize=9)
    save(fig, "fig3_amdahl.png")

    # ---- Figure 4: input size and optimization (extra experiments) ----
    if big or opt:
        fig, ax = plt.subplots(figsize=(7.4, 4.6))
        style(ax, "Speedup up to 64 threads on a 64-core allocation", "Threads", "Speedup")
        p64 = [1, 2, 4, 8, 16, 32, 64]
        log2_axis(ax, p64)
        ax.plot(p64, p64, color=MUTED, linestyle="--", linewidth=2, label="Linear")
        ax.set_ylim(0, 20)
        a10 = [s for s in ext10]
        ax.plot([s["threads"] for s in a10], [s["speedup"] for s in a10], color=BLUE,
                marker="o", markersize=7, linewidth=2, label="N = 10M, -O0 (16-core job + 64-core job)")
        if big:
            ax.plot([s["threads"] for s in big], [s["speedup"] for s in big], color=ORANGE,
                    marker="s", markersize=7, linewidth=2, label="N = 50M, -O0")
        if opt:
            ax.plot([s["threads"] for s in opt], [s["speedup"] for s in opt], color=AQUA,
                    marker="D", markersize=6, linewidth=2, label="N = 10M, -O2")
        ax.legend(frameon=False, loc="upper left", labelcolor=INK, fontsize=9)
        save(fig, "fig4_extra.png")

    # ---- Figure 5: per-level merge times in a parallel run ----
    if prof:
        fig, ax = plt.subplots(figsize=(7.4, 4.4))
        style(ax, "Merge time per level in the parallel run (N = 10M)",
              "Merge level k (0 = top, size N/2^k)", "Time of one merge (s)")
        for t, color, marker in [(16, BLUE, "o"), (64, ORANGE, "s")]:
            pr = [q for q in prof if q["threads"] == t]
            if not pr:
                continue
            top = max(q["level"] for q in pr)
            ks = sorted({top - q["level"] for q in pr})
            means = []
            for k in ks:
                vals = [q["sec"] for q in pr if top - q["level"] == k]
                means.append(sum(vals) / len(vals))
            ax.plot(ks, means, color=color, marker=marker, markersize=7, linewidth=2,
                    label=f"Measured, {t} threads (mean per level)")
        ks = list(range(0, 6))
        ax.plot(ks, [Tm / 2 ** k for k in ks], color=MUTED, linestyle="--", linewidth=2,
                label="Ideal Tm / 2^k")
        ax.set_yscale("log", base=2)
        ax.set_xticks(ks)
        ax.legend(frameon=False, loc="upper right", labelcolor=INK, fontsize=9)
        save(fig, "fig5_merge_levels.png")

    dag()
    workbook(runs, summary, prof, T1, Tm)


def dag():
    """Computational DAG for THREAD_LEVEL = 3 (8 threads)."""
    L = 3
    fig, ax = plt.subplots(figsize=(11, 7.2))
    ax.set_xlim(-0.5, 2 ** L + 0.9)
    ax.set_ylim(0.4, 2 * L + 2.0)
    ax.axis("off")
    fig.patch.set_facecolor(SURFACE)

    def node(x, y, text, color, w=0.86, h=0.62):
        ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                    facecolor=SURFACE, edgecolor=color, linewidth=2))
        ax.text(x, y, text, ha="center", va="center", fontsize=8.2, color=INK)

    def edge(x0, y0, x1, y1, bold=False):
        # bottom edge of the source box to the top edge of the target box
        ax.annotate("", xy=(x1, y1 + 0.36), xytext=(x0, y0 - 0.36),
                    arrowprops=dict(arrowstyle="-|>", color=ORANGE if bold else MUTED,
                                    lw=2.4 if bold else 1.1, shrinkA=0, shrinkB=0))

    top = 2 * L + 1
    # forks: level d has 2^d nodes, at y = top - d
    pos = {}
    for d in range(L):
        n = 2 ** d
        for i in range(n):
            x = (i + 0.5) * 2 ** L / n - 0.5
            pos[("f", d, i)] = (x, top - d)
            label = "start\nO(1)" if d == 0 else "fork\nO(1)"
            node(x, top - d, label, VIOLET)
    yl = top - L
    for i in range(2 ** L):
        pos[("l", i)] = (i, yl)
        node(i, yl, "sort N/8\n(N/8)lg(N/8)", BLUE, w=0.92, h=0.7)
    for d in range(L - 1, -1, -1):
        n = 2 ** d
        y = yl - (L - d)
        for i in range(n):
            x = (i + 0.5) * 2 ** L / n - 0.5
            pos[("m", d, i)] = (x, y)
            node(x, y, f"merge\n{'N' if d == 0 else 'N/' + str(2 ** d)}", AQUA)
    # edges; critical path follows the leftmost branch
    for d in range(L):
        for i in range(2 ** d):
            x0, y0 = pos[("f", d, i)]
            for c in (2 * i, 2 * i + 1):
                tgt = pos[("f", d + 1, c)] if d + 1 < L else pos[("l", c)]
                edge(x0, y0, *tgt, bold=(i == 0 and c == 0))
    for d in range(L - 1, -1, -1):
        for i in range(2 ** d):
            x1, y1 = pos[("m", d, i)]
            for c in (2 * i, 2 * i + 1):
                src = pos[("m", d + 1, c)] if d + 1 < L else pos[("l", c)]
                edge(*src, x1, y1, bold=(i == 0 and c == 0))
    ax.text(-0.45, top + 0.75, "Computational DAG, THREAD_LEVEL = 3 (8 threads). Node labels = work.",
            fontsize=11, color=INK, ha="left")
    ax.text(-0.45, top + 0.38, "Thick orange edges: one critical path (all root-to-sink paths have equal length).",
            fontsize=9, color=INK2, ha="left")
    for y, lab in [(top - 1, "fork levels"), (yl, "leaf sorts\n(sequential)"), (yl - 2, "merge levels")]:
        ax.text(2 ** L - 0.35, y, lab, fontsize=9, color=INK2, ha="left", va="center")
    fig.tight_layout()
    FIGS.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGS / "fig6_dag.png", dpi=200)
    plt.close(fig)


def workbook(runs, summary, prof, T1, Tm):
    wb = Workbook()
    bold = Font(bold=True)
    head = PatternFill("solid", fgColor="E8EEF8")

    def header(ws, cols):
        ws.append(cols)
        for c in ws[1]:
            c.font = bold
            c.fill = head
            c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "A2"

    ws = wb.active
    ws.title = "Raw runs"
    cols = ["exp", "build", "n", "threads", "run", "seq", "par", "seq_merge", "par_merge", "qsort", "file"]
    header(ws, cols)
    for r in runs:
        if not r["profile"]:
            ws.append([r.get(c, None) if r.get(c, "") != "" else None for c in cols])
    nraw = ws.max_row
    for i in range(1, len(cols) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 13

    # Summary with live formulas over the raw sheet.
    ss = wb.create_sheet("Summary")
    header(ss, ["exp", "build", "n", "threads", "runs", "seq mean (s)", "seq sd", "par mean (s)",
                "par sd", "top merge mean (s)", "speedup", "efficiency", "linear"])
    R = f"'Raw runs'!"
    for s in summary:
        row = ss.max_row + 1
        crit = (f'{R}$A$2:$A${nraw},A{row},{R}$C$2:$C${nraw},C{row},{R}$D$2:$D${nraw},D{row}')
        ss.append([s["exp"], s["build"], s["n"], s["threads"],
                   f"=COUNTIFS({crit})",
                   f"=AVERAGEIFS({R}$F$2:$F${nraw},{crit})",
                   s["seq_sd"],
                   f"=AVERAGEIFS({R}$G$2:$G${nraw},{crit})",
                   s["par_sd"],
                   f"=AVERAGEIFS({R}$H$2:$H${nraw},{crit})",
                   f"=F{row}/H{row}", f"=K{row}/D{row}", f"=D{row}"])
    for i in range(1, 14):
        ss.column_dimensions[get_column_letter(i)].width = 13
    nmain = sum(1 for s in summary if s["exp"] == "main")
    ch = LineChart()
    ch.title = "Speedup vs linear, N = 10M"
    ch.x_axis.title = "Threads"
    ch.y_axis.title = "Speedup"
    ch.add_data(Reference(ss, min_col=11, min_row=1, max_row=1 + nmain), titles_from_data=True)
    ch.add_data(Reference(ss, min_col=13, min_row=1, max_row=1 + nmain), titles_from_data=True)
    ch.set_categories(Reference(ss, min_col=4, min_row=2, max_row=1 + nmain))
    ch.width, ch.height = 16, 9
    ss.add_chart(ch, "O2")

    # Amdahl sheet: change the inputs and everything recomputes.
    am = wb.create_sheet("Amdahl")
    am["A1"], am["B1"] = "Input", "Value"
    am["A1"].font = am["B1"].font = bold
    rows = [("N", N), ("T1 sequential mergesort (s)", T1), ("Tm top-level merge (s)", Tm),
            ("f, top merge only = Tm/T1", "=B4/B3"),
            ("f, all merge levels = 2*Tm/T1", "=2*B4/B3"),
            ("max speedup, top merge only = 1/f", "=1/B5"),
            ("max speedup, all merge levels = 1/f", "=1/B6"),
            ("check: Tm * log2(N) vs T1", "=B4*LOG(B2,2)")]
    for i, (k, v) in enumerate(rows, start=2):
        am.cell(row=i, column=1, value=k)
        am.cell(row=i, column=2, value=v)
    am.cell(row=11, column=1, value="threads p").font = bold
    hdr = ["threads p", "L = log2 p", "Amdahl (top merge only)", "Amdahl (all levels)",
           "work-span T_p (s)", "work-span speedup", "measured speedup", "linear"]
    for j, h in enumerate(hdr, start=1):
        c = am.cell(row=11, column=j, value=h)
        c.font = bold
        c.fill = head
    meas = {s["threads"]: s for s in summary if s["exp"] in ("main", "A")}
    for i, p in enumerate([1, 2, 4, 8, 16, 32, 64], start=12):
        am.cell(row=i, column=1, value=p)
        am.cell(row=i, column=2, value=f"=LOG(A{i},2)")
        am.cell(row=i, column=3, value=f"=1/($B$5+(1-$B$5)/A{i})")
        am.cell(row=i, column=4, value=f"=1/($B$6+(1-$B$6)/A{i})")
        am.cell(row=i, column=5, value=f"=LOG($B$2/A{i},2)*$B$4/A{i}+IF(B{i}>0,$B$4*(2-2^(1-B{i})),0)")
        am.cell(row=i, column=6, value=f"=$B$3/E{i}")
        if p in meas:
            am.cell(row=i, column=7, value=round(meas[p]["speedup"], 4))
        am.cell(row=i, column=8, value=f"=A{i}")
    am.column_dimensions["A"].width = 38
    for col in "BCDEFGH":
        am.column_dimensions[col].width = 16
    sc = ScatterChart()
    sc.title = "Amdahl prediction vs measured"
    sc.x_axis.title = "Threads"
    sc.y_axis.title = "Speedup"
    xs = Reference(am, min_col=1, min_row=12, max_row=18)
    for col in (3, 4, 6, 7):
        s = Series(Reference(am, min_col=col, min_row=11, max_row=18), xs, title_from_data=True)
        s.marker.symbol = "circle"
        sc.series.append(s)
    sc.width, sc.height = 18, 10
    am.add_chart(sc, "J2")

    if prof:
        ps = wb.create_sheet("Merge profile")
        header(ps, ["threads", "run", "level (remaining)", "size", "sec"])
        for q in prof:
            ps.append([q["threads"], q["run"], q["level"], q["size"], q["sec"]])

    wb.save(RES / "PA3 results.xlsx")


if __name__ == "__main__":
    main()
