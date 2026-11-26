#!/usr/bin/env bash
# Drives Matrix 8K Player in the Android emulator (1.5 GB, like a Fire TV Stick) with remote-control key
# presses and saves screenshots and the app log to ./device-test/.
# The playlist is a pretend Xtream provider the size of a real one (xtream-mock.py): 15,000 channels,
# 60,000 films, 15,000 series and a 300 MB guide.
set -uo pipefail
out=device-test; mkdir -p "$out"
key() { for k in "$@"; do adb shell input keyevent "$k"; sleep 0.6; done; }
shot() { sleep "${2:-1}"; adb exec-out screencap -p > "$out/$1.png"; echo "shot $1"; }
# Frame timing from Android (gfxinfo): reset before a burst of key presses, report after it.
PKG=com.matrixstreams.player
frames_reset() { adb shell dumpsys gfxinfo $PKG reset > /dev/null; }
frames() { echo "FRAMES $1: $(adb shell dumpsys gfxinfo $PKG | grep -E 'Total frames rendered|Janky frames|50th percentile|90th percentile|99th percentile' | tr -s ' ' | tr '\n' ';')" | tee -a "$out/frames.txt"; }
burst() { for k in "$@"; do adb shell input keyevent "$k"; done; sleep 1; }
alive() { adb shell pidof com.matrixstreams.player > /dev/null && echo yes || echo NO; }
mem() { echo "$1: app alive=$(alive) $(adb shell dumpsys meminfo | grep -E 'com.matrixstreams.player|sandboxed_process' | tr -s ' ' | tr '\n' ';')" | tee -a "$out/memory.txt"; }
wait_log() { # wait_log <pattern> <seconds> <shot prefix>
  local i=0
  while [ $i -lt "$2" ]; do
    adb logcat -d | grep -q "$1" && return 0
    if [ $((i % 6)) -eq 2 ]; then shot "$3-$(printf %03d $i)" 0; mem "$3 t=${i}s"; fi
    sleep 2; i=$((i + 2))
  done
  echo "timed out waiting for $1"; return 1
}

adb install -r OrbitTV-debug.apk
adb logcat -c
adb shell am start -n com.matrixstreams.player/.MainActivity
sleep 20
shot 01-welcome
# Add the provider the way a phone would after scanning the QR code: post the form to the TV.
pair=$(adb logcat -d | grep -o 'pairing http://[^ "]*' | tail -1 | cut -d' ' -f2)
echo "pairing address: $pair"
port=$(echo "$pair" | sed -E 's#http://[^:]+:([0-9]+)/.*#\1#'); token=$(echo "$pair" | sed -E 's#.*/##')
adb forward tcp:9555 tcp:"$port"
curl -s "http://127.0.0.1:9555/$token" | grep -c 'Send to TV' | sed 's/^/phone page has the form: /'
curl -s -o /dev/null -w 'wrong token answers %{http_code}\n' "http://127.0.0.1:9555/wrong"
curl -s --data-urlencode type=xtream --data-urlencode server=http://10.0.2.2:8098 --data-urlencode user=test --data-urlencode pass=test --data-urlencode name=Matrix "http://127.0.0.1:9555/$token" | grep -c 'Sent to your TV' | sed 's/^/phone page shows sent: /'
# The start-up screen: four boxes filling in. Wait (up to 6 minutes) for it to finish.
wait_log '\[orbit\] startup finished' 360 02-boot
adb logcat -d | grep -E '\[orbit\] guide' | tail -2
mem after-startup
shot 03-home 2
# Home: Live TV is the highlighted tile. OK opens the categories with channel cards.
shot 04-home-tiles
frames_reset; burst DPAD_RIGHT DPAD_RIGHT DPAD_RIGHT DPAD_DOWN DPAD_UP DPAD_LEFT DPAD_LEFT DPAD_LEFT; frames home
key DPAD_CENTER
shot 05-live-open 6
# Speed: scroll the categories down and back, then the channel cards down and back.
frames_reset; burst $(printf 'DPAD_DOWN %.0s' $(seq 1 15)) $(printf 'DPAD_UP %.0s' $(seq 1 15)); frames live-categories
frames_reset; burst DPAD_RIGHT $(printf 'DPAD_DOWN %.0s' $(seq 1 6)) $(printf 'DPAD_UP %.0s' $(seq 1 6)) DPAD_LEFT; frames live-cards
# Right into the cards, OK on the first: the mini screen plays it beside the channel list.
key DPAD_RIGHT DPAD_CENTER
shot 06-live-preview-playing 8
adb logcat -d | grep "OrbitPlayer.*layout rect" | tail -2
key DPAD_DOWN DPAD_DOWN DPAD_DOWN
shot 07-live-browsed 3
key DPAD_CENTER
shot 08-live-preview-ts 8
key DPAD_CENTER
shot 09-full 6
key DPAD_UP
shot 10-full-zapped 6
key BACK
shot 11-back-to-preview 4
frames_reset
for i in $(seq 1 25); do adb shell input keyevent DPAD_DOWN; done
shot 12-after-fast-scroll 2
frames channel-list-with-preview
mem live-tv
# Live Sports: Back to the cards, Back to the categories, Back Home; Down to the footer, Right twice.
key BACK BACK BACK DPAD_DOWN DPAD_RIGHT DPAD_RIGHT DPAD_CENTER
shot 13-sports 8
key DPAD_RIGHT DPAD_DOWN
shot 14-sports-fixture 3
key BACK DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_CENTER
shot 15-sports-events 3
# Films: Back Home (Live TV is highlighted), Right twice to VOD.
key BACK BACK DPAD_RIGHT DPAD_RIGHT DPAD_CENTER
shot 16-movies 4
key DPAD_RIGHT DPAD_CENTER
shot 17-film-page 3
key DPAD_CENTER
shot 18-film-playing 8
key DPAD_CENTER
shot 19-film-controls 1
key BACK BACK
shot 20-film-closed 2
# TV Guide: Back to the film's poster, Back to its category, Back Home, Right once to TV Guide.
key BACK BACK BACK DPAD_RIGHT DPAD_CENTER
shot 21-tv-guide 6
key DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN
shot 22-tv-guide-scrolled 3
mem guide
# Start again: the saved playlist and guide should come up in seconds.
adb logcat -d > "$out/logcat-first-run.txt"
adb shell am force-stop com.matrixstreams.player
adb logcat -c
adb shell am start -n com.matrixstreams.player/.MainActivity
shot 23-relaunch 6
wait_log '\[orbit\] startup finished' 120 24-relaunch
shot 25-relaunch-home 2
key DPAD_CENTER
shot 26-relaunch-live 6
# Back from the categories goes Home; Back at Home asks before leaving.
key BACK BACK
shot 27-leave-dialog 1
key DPAD_CENTER
shot 28-after-ok-on-dialog 2
mem end
adb logcat -d > "$out/logcat.txt"
grep -hE "\[orbit\]|OrbitPlayer|guide|FATAL|AndroidRuntime|render process|Error|error" "$out/logcat.txt" | grep -v "Notifying listeners\|Phenotype\|RcsClientLib" > "$out/app-log.txt" || true
grep -hE "\[orbit\] (guide|startup)|methodName: guide|FATAL" "$out/logcat-first-run.txt" "$out/logcat.txt" | cut -c1-400 > "$out/summary.txt" || true
