#!/usr/bin/env bash
# Says whether a scheduled run should go ahead, from the UK wall-clock time:
#   true   inside the evening sync window: run in full
#   late   after the window but before LATE_END: run only if work is still waiting (GitHub often starts scheduled runs late)
#   false  outside both: stop
#
# GitHub Actions cron runs in UTC only, so the workflow checks every 15 minutes across the evening and this script
# decides from the UK clock (it follows GMT and BST).
#
#   in-window.sh                      uses the current time
#   in-window.sh "2026-07-01 19:32Z"  uses the given time (for testing)
#
# Times (UK, HHMM): WINDOW_START to WINDOW_END, default 20:30 to 21:29; late runs until LATE_END, default 01:59 the next
# morning (a LATE_END earlier than WINDOW_START means the next morning).
set -euo pipefail
start="${WINDOW_START:-2030}"
end="${WINDOW_END:-2129}"
late_end="${LATE_END:-0159}"
if [ $# -ge 1 ]; then
  uk=$(TZ=Europe/London date -d "$1" +%H%M)
else
  uk=$(TZ=Europe/London date +%H%M)
fi
now=$((10#$uk))
if [ "$now" -ge $((10#$start)) ] && [ "$now" -le $((10#$end)) ]; then echo true
elif [ $((10#$late_end)) -lt $((10#$start)) ] && { [ "$now" -gt $((10#$end)) ] || [ "$now" -le $((10#$late_end)) ]; }; then echo late
elif [ "$now" -gt $((10#$end)) ] && [ "$now" -le $((10#$late_end)) ]; then echo late
else echo false; fi
