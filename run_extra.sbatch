#!/bin/bash
#SBATCH -J pa3-extra
#SBATCH -p RM-shared
#SBATCH -N 1
#SBATCH --ntasks-per-node=64
#SBATCH -t 01:00:00
#SBATCH -o pa3-extra-%j.out

# Follow-up experiments beyond run.sbatch:
#   A: 10M elements, 32 and 64 threads (extends the 1-16 curve)
#   B: 50M elements, 1-64 threads (longer runs, less timer noise)
#   C: per-level merge times in the parallel run (MERGE_PROFILE)
#   D: same as the main sweep but compiled with -O2

set -e
echo "host: $(hostname)  cpus: $(nproc)  date: $(date)"
echo "### lscpu"; lscpu
echo "### memory"; free -g
echo "### numa"; numactl -H 2>/dev/null || true
echo "### gcc"; gcc --version | head -1

build() {   # build <level> <name> [extra gcc flags]
  sed -E "s/^(#define[[:space:]]+THREAD_LEVEL[[:space:]]+)[0-9]+/\1$1/" \
    parallelMergesort.c > $2.c
  grep -q "THREAD_LEVEL[[:space:]]*$1" $2.c || { echo "THREAD_LEVEL not set in $2.c"; exit 1; }
  gcc ${@:3} -o $2 $2.c -lpthread
}

for level in 0 1 2 3 4 5 6; do
  t=$((1 << level))
  build $level x$t
  build $level o$t -O2
done
build 4 prof16 -DMERGE_PROFILE
build 6 prof64 -DMERGE_PROFILE

echo "### A: N=10000000, 32 and 64 threads"
for t in 32 64; do
  for r in 1 2 3 4 5; do echo "=== A threads=$t run=$r"; ./x$t 10000000; done
done

echo "### B: N=50000000"
for t in 1 2 4 8 16 32 64; do
  for r in 1 2 3; do echo "=== B threads=$t run=$r"; ./x$t 50000000; done
done

echo "### C: merge profile, N=10000000"
for p in prof16 prof64; do
  for r in 1 2 3; do echo "=== C $p run=$r"; ./$p 10000000; done
done

echo "### D: -O2, N=10000000"
for t in 1 2 4 8 16 32 64; do
  for r in 1 2 3; do echo "=== D threads=$t run=$r"; ./o$t 10000000; done
done
echo "### done $(date)"
