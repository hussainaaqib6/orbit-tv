#!/usr/bin/env bash
# Test playlist, guide and videos for the Android device test. Served at http://10.0.2.2:8099 to the emulator.
set -euo pipefail
dir="$1"; mkdir -p "$dir/hls"
# Live channel: colour bars with a moving pattern (HLS).
ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440 -t 120 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f hls -hls_time 4 -hls_list_size 0 "$dir/hls/index.m3u8"
# A second live channel as raw MPEG-TS (what Xtream servers send).
ffmpeg -loglevel error -y -f lavfi -i "smptehdbars=size=1280x720:rate=25" -f lavfi -i sine=frequency=660 -t 120 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f mpegts "$dir/live2.ts"
# A film: plain blue with a counter, so it can't be confused with the live pictures.
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x2040c0:size=1280x720:rate=25" -f lavfi -i sine=frequency=330 -t 60 \
  -vf "drawtext=text='FILM %{pts\\:hms}':fontsize=96:fontcolor=white:x=(w-tw)/2:y=(h-th)/2" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac "$dir/film.mp4" || \
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x2040c0:size=1280x720:rate=25" -f lavfi -i sine=frequency=330 -t 60 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac "$dir/film.mp4"
python3 - "$dir" <<'PY'
import sys, datetime
d = sys.argv[1]
now = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0)
m3u = ['#EXTM3U x-tvg-url="http://10.0.2.2:8099/guide.xml"']
xml = ['<?xml version="1.0"?><tv>']
for i in range(1, 41):
    url = 'http://10.0.2.2:8099/hls/index.m3u8' if i % 2 else 'http://10.0.2.2:8099/live2.ts'
    m3u += [f'#EXTINF:-1 tvg-id="c{i}" group-title="{"Entertainment" if i <= 20 else "Sport"}",UK: Channel {i} HD', url]
    xml.append(f'<channel id="c{i}"><display-name>Channel {i}</display-name></channel>')
    for h in range(-3, 6):
        s = now + datetime.timedelta(hours=h); e = s + datetime.timedelta(hours=1)
        xml.append(f'<programme start="{s:%Y%m%d%H%M%S} +0000" stop="{e:%Y%m%d%H%M%S} +0000" channel="c{i}"><title>Show {h + 4} on {i}</title><desc>Description.</desc></programme>')
for i in range(12):
    m3u += [f'#EXTINF:-1 group-title="Films",Test Film {i} (2024)', 'http://10.0.2.2:8099/film.mp4']
xml.append('</tv>')
open(f'{d}/playlist.m3u', 'w').write('\n'.join(m3u))
open(f'{d}/guide.xml', 'w').write('\n'.join(xml))
PY
