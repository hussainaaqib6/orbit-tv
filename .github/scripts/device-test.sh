#!/usr/bin/env bash
# Drives Orbit TV in the Android emulator with remote-control key presses and saves screenshots
# and the app log to ./device-test/.
set -uo pipefail
out=device-test; mkdir -p "$out"
key() { for k in "$@"; do adb shell input keyevent "$k"; sleep 0.6; done; }
shot() { sleep "${2:-1}"; adb exec-out screencap -p > "$out/$1.png"; echo "shot $1"; }

adb install -r OrbitTV-debug.apk
adb logcat -c
adb shell am start -n tv.orbit.player/.MainActivity
sleep 20
shot 01-welcome
# Add the playlist the way a phone would after scanning the QR code: post the form to the TV.
pair=$(adb logcat -d | grep -o 'pairing http://[^ "]*' | tail -1 | cut -d' ' -f2)
echo "pairing address: $pair"
port=$(echo "$pair" | sed -E 's#http://[^:]+:([0-9]+)/.*#\1#'); token=$(echo "$pair" | sed -E 's#.*/##')
adb forward tcp:9555 tcp:"$port"
curl -s "http://127.0.0.1:9555/$token" | grep -c 'Send to TV' | sed 's/^/phone page has the form: /'
curl -s -o /dev/null -w 'wrong token answers %{http_code}\n' "http://127.0.0.1:9555/wrong"
curl -s --data-urlencode type=m3u --data-urlencode url=http://10.0.2.2:8099/playlist.m3u --data-urlencode name=Test "http://127.0.0.1:9555/$token" | grep -c 'Sent to your TV' | sed 's/^/phone page shows sent: /'
shot 01b-received 3
sleep 12
shot 02-home
# Menu: Back to the side menu, down to Live TV.
key BACK
shot 03-menu
key DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_CENTER
shot 04-live-open 6
key DPAD_CENTER
shot 05-live-preview-playing 8
key DPAD_DOWN DPAD_DOWN DPAD_DOWN
shot 06-live-browsed 3
key DPAD_CENTER
shot 07-live-preview-ts 8
key DPAD_CENTER
shot 08-full 6
key DPAD_UP
shot 09-full-zapped 6
# The controls have hidden themselves by now, so one Back closes full screen.
key BACK
shot 10-back-to-preview 4
# Holding Down in the channel list: 25 fast presses.
for i in $(seq 1 25); do adb shell input keyevent DPAD_DOWN; done
shot 10b-after-fast-scroll 2
# Films: from the list, Back to categories, Back to the menu, down to Movies.
key BACK BACK DPAD_DOWN DPAD_CENTER
shot 11-movies 3
key DPAD_RIGHT DPAD_CENTER
shot 12-film-page 3
key DPAD_CENTER
shot 13-film-starting 1
shot 14-film-playing 6
key DPAD_CENTER
shot 14b-film-controls 1
key BACK BACK
shot 14c-film-closed 2
# Menu reachability: Back to the menu and walk it; then Back shows "Leave?" with Stay selected.
key BACK BACK DPAD_UP DPAD_UP DPAD_UP DPAD_UP DPAD_UP
shot 15-menu-top 1
key DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN DPAD_DOWN
shot 16-menu-bottom 1
key BACK
shot 17-leave-dialog 1
key DPAD_CENTER
shot 18-after-ok-on-dialog 2
adb logcat -d > "$out/logcat.txt"
grep -E "\[orbit\]|OrbitPlayer: layout|Error|error" "$out/logcat.txt" | grep -v "Notifying listeners" > "$out/app-log.txt" || true
