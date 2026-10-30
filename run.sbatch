#!/bin/bash
#SBATCH -J pa3-mergesort
#SBATCH -p RM-shared
#SBATCH -N 1
#SBATCH --ntasks-per-node=16
#SBATCH -t 00:30:00
#SBATCH -o pa3-%j.out

# Builds one executable per thread count (THREAD_LEVEL = log2 threads)
# and runs each RUNS times on the same input size.
N=${N:-10000000}
RUNS=${RUNS:-5}

set -e
echo "host: $(hostname)  cpus: $(nproc)  date: $(date)"
for level in 0 1 2 3 4; do
  t=$((1 << level))
  sed -E "s/^(#define[[:space:]]+THREAD_LEVEL[[:space:]]+)[0-9]+/\1$level/" \
    parallelMergesort.c > ms$t.c
  grep -q "THREAD_LEVEL[[:space:]]*$level" ms$t.c || { echo "THREAD_LEVEL not set in ms$t.c"; exit 1; }
  gcc -o mergesort$t ms$t.c -lpthread
done

for t in 1 2 4 8 16; do
  for r in $(seq 1 $RUNS); do
    echo "=== threads=$t run=$r"
    ./mergesort$t $N
  done
done
