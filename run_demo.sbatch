#!/bin/bash
#SBATCH -J pa3-evidence
#SBATCH -p RM-shared
#SBATCH -N 1
#SBATCH --ntasks-per-node=16
#SBATCH -t 00:40:00
#SBATCH -o pa3-evidence-%j.out

# Evidence for the demo, on the same 16-core allocation as run.sbatch:
#   E: CPU utilization (/usr/bin/time -v) for 1 and 16 threads
#   F: thread placement snapshot (ps -L) while mergesort16 runs
#   G: hardware counters (perf stat) for 1 and 16 threads
#   H: input-size sweep at 1 and 16 threads

set -e
echo "host: $(hostname)  cpus: $(nproc)  date: $(date)"
echo "allowed cpus: $(grep Cpus_allowed_list /proc/self/status)"

for level in 0 4; do
  t=$((1 << level))
  sed -E "s/^(#define[[:space:]]+THREAD_LEVEL[[:space:]]+)[0-9]+/\1$level/" \
    parallelMergesort.c > ev$t.c
  grep -q "THREAD_LEVEL[[:space:]]*$level" ev$t.c || { echo "THREAD_LEVEL not set in ev$t.c"; exit 1; }
  gcc -o ev$t ev$t.c -lpthread
done

echo "### E: /usr/bin/time -v"
for t in 1 16; do
  echo "=== E threads=$t"
  /usr/bin/time -v ./ev$t 10000000 2>&1 | egrep -v "^\s*(Average|Exit status: 0|Socket|Signals|Swaps|File system|Page size|Major)"
done

echo "### F: thread snapshot"
./ev16 100000000 > ev16-big.txt &
pid=$!
# The sequential sort runs first (about 28 s for 1e8); sample during the parallel part.
for s in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35; do
  sleep 1
  n=$(ps -L -p $pid --no-headers 2>/dev/null | wc -l)
  if [ "$n" -ge 16 ]; then
    echo "=== F after ${s}s, $n threads in process $pid"
    ps -L -o pid,lwp,psr,pcpu,stat,comm -p $pid
    break
  fi
done
wait $pid
echo "=== F program output"
cat ev16-big.txt

echo "### G: perf stat"
if command -v perf >/dev/null; then
  for t in 1 16; do
    echo "=== G threads=$t"
    perf stat -e task-clock,cycles,instructions,cache-references,cache-misses,context-switches,cpu-migrations \
      ./ev$t 10000000 2>&1
  done
else
  echo "perf not available"
fi

echo "### H: input size sweep"
for n in 1000000 10000000 100000000; do
  for t in 1 16; do
    for r in 1 2 3; do
      echo "=== H n=$n threads=$t run=$r"
      ./ev$t $n
    done
  done
done
echo "### done $(date)"
