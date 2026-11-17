#!/usr/bin/env bash
# Prints "true" when the UK wall-clock time is inside the evening sync window, else "false".
#
# GitHub Actions cron runs in UTC only. The workflow is scheduled twice (19:32 and
# 20:32 UTC); in any given week exactly one of those is 20:32 UK time (BST or GMT).
# This script lets that one through and turns the other away in seconds.
#
#   in-window.sh                      uses the current time
#   in-window.sh "2026-07-01 19:32Z"  uses the given time (for testing)
#
# Window (UK time, HHMM): WINDOW_START to WINDOW_END, default 20:30 to 21:29.
# The end leaves room for GitHub starting a scheduled run late.
set -euo pipefail
start="${WINDOW_START:-2030}"
end="${WINDOW_END:-2129}"
if [ $# -ge 1 ]; then
  uk=$(TZ=Europe/London date -d "$1" +%H%M)
else
  uk=$(TZ=Europe/London date +%H%M)
fi
now=$((10#$uk))
if [ "$now" -ge $((10#$start)) ] && [ "$now" -le $((10#$end)) ]; then echo true; else echo false; fi
