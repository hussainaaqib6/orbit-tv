#!/usr/bin/env bash
# Adds a provider the size of a real one and watches whether the app survives loading it.
set -uo pipefail
out=device-test; mkdir -p "$out"
shot() { sleep "${2:-1}"; adb exec-out screencap -p > "$out/$1.png"; echo "shot $1"; }
adb install -r OrbitTV-debug.apk
adb logcat -c
adb shell am start -n tv.orbit.player/.MainActivity
sleep 20
pair=$(adb logcat -d | grep -o 'pairing http://[^ "]*' | tail -1 | cut -d' ' -f2)
port=$(echo "$pair" | sed -E 's#http://[^:]+:([0-9]+)/.*#\1#'); token=$(echo "$pair" | sed -E 's#.*/##')
adb forward tcp:9555 tcp:"$port"
curl -s --data-urlencode type=xtream --data-urlencode server=http://10.0.2.2:8098 --data-urlencode user=test --data-urlencode pass=test --data-urlencode name=Big "http://127.0.0.1:9555/$token" > /dev/null
for i in $(seq 1 16); do
  shot "load-$(printf %02d $i)" 15
  echo "t=$((i*15))s pid=$(adb shell pidof tv.orbit.player) mem=$(adb shell dumpsys meminfo tv.orbit.player | grep -E 'TOTAL PSS|TOTAL:' | head -1)"
done
adb logcat -d > "$out/logcat.txt"
grep -iE "\[orbit\]|render process|crash|FATAL|lowmemory|killing|died|OutOfMemory" "$out/logcat.txt" | head -200 > "$out/app-log.txt" || true
