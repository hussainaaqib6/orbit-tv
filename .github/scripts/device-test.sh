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
# Welcome form: M3U link, type the address, submit.
key DPAD_RIGHT DPAD_CENTER DPAD_DOWN
adb shell input text 'http://10.0.2.2:8099/playlist.m3u'
key ENTER
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
key BACK
shot 10a-controls-hidden 1
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
