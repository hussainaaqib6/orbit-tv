#!/usr/bin/env python3
"""A pretend Xtream Codes provider the size of a real one, for the Android device test.

  python3 xtream-mock.py <dir> [port]

Serves player_api.php (15,000 channels, 60,000 films, 15,000 series) and an XMLTV guide of
roughly 300 MB, like the big providers people actually use. Streams redirect to the small test
videos made by make-fixtures.sh, served on port 8099. Today's football matches appear as event
channels ("EPL 01: Arsenal v Chelsea") so the Live Sports tab has something to find.
"""
import datetime, json, os, random, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DIR = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8098
STATIC = 'http://10.0.2.2:8099'
N_LIVE, N_VOD, N_SERIES, N_GUIDE = 57000, 188000, 50000, 6000
GUIDE_DAYS_BACK, GUIDE_DAYS_AHEAD = 2, 5
rnd = random.Random(7)

COUNTRIES = ['UK', 'US', 'ES', 'IT', 'DE', 'FR', 'NL', 'PT', 'AR', 'TR', 'IN', 'PK', 'PL', 'GR', 'SE']
GENRES = ['Entertainment', 'Sports', 'News', 'Movies', 'Kids', 'Documentary', 'Music', 'Religious']
TEAMS = [('Arsenal', 'Chelsea'), ('Liverpool', 'Manchester United'), ('Tottenham Hotspur', 'Newcastle United'),
         ('Manchester City', 'Aston Villa'), ('Brighton & Hove Albion', 'West Ham United'),
         ('Real Madrid', 'Barcelona'), ('Atletico Madrid', 'Sevilla'), ('Bayern Munich', 'Borussia Dortmund'),
         ('Inter Milan', 'AC Milan'), ('Paris Saint-Germain', 'Marseille')]

live_cats = [{'category_id': str(i + 1), 'category_name': f'{c} | {g}', 'parent_id': 0}
             for i, (c, g) in enumerate((c, g) for c in COUNTRIES for g in GENRES)]
live_cats += [{'category_id': '900', 'category_name': 'EPL Events', 'parent_id': 0},
              {'category_id': '901', 'category_name': 'LaLiga Events', 'parent_id': 0},
              {'category_id': '902', 'category_name': 'UK | Sky Sports', 'parent_id': 0}]

live = []
sky = ['Sky Sports Main Event', 'Sky Sports Premier League', 'Sky Sports Football', 'TNT Sports 1', 'TNT Sports 2',
       'Sky Sports F1', 'DAZN 1', 'LaLiga TV', 'Premier Sports 1', 'BBC One', 'ITV1', 'Channel 4']
for i, name in enumerate(sky):
    live.append({'num': i + 1, 'name': f'UK: {name} FHD', 'stream_type': 'live', 'stream_id': 100000 + i,
                 'stream_icon': '', 'epg_channel_id': name.replace(' ', '').lower() + '.uk', 'category_id': '902',
                 'tv_archive': 1 if i % 3 == 0 else 0, 'tv_archive_duration': 3})
live.insert(0, {'num': 0, 'name': '##### UNITED KINGDOM #####', 'stream_type': 'live', 'stream_id': 99999, 'stream_icon': '', 'epg_channel_id': '', 'category_id': '1'})
for i, (h, a) in enumerate(TEAMS):
    cat = '901' if i in (5, 6) else '900'
    pre = 'LaLiga' if cat == '901' else 'EPL'
    live.append({'num': 0, 'name': f'{pre} {i + 1:02d}: {h} v {a} @ 20:00', 'stream_type': 'live',
                 'stream_id': 110000 + i, 'stream_icon': '', 'epg_channel_id': '', 'category_id': cat})
for i in range(N_LIVE - len(live)):
    cat = live_cats[i % (len(COUNTRIES) * len(GENRES))]
    c = cat['category_name'].split(' |')[0]
    live.append({'num': 0, 'name': f'{c}: Channel {i} {rnd.choice(["HD", "FHD", "SD", "4K"])}', 'stream_type': 'live',
                 'stream_id': i + 1, 'stream_icon': '', 'epg_channel_id': f'ch{i % N_GUIDE}.{COUNTRIES[(i % N_GUIDE) % len(COUNTRIES)].lower()}',
                 'category_id': cat['category_id'], 'tv_archive': 0, 'tv_archive_duration': 0, 'added': '1700000000'})

vod_cats = [{'category_id': str(i + 1), 'category_name': f'{c} | {g}', 'parent_id': 0}
            for i, (c, g) in enumerate((c, g) for c in COUNTRIES[:6] for g in ['Action', 'Comedy', 'Drama', 'Horror', 'Family', '4K'])]
vod = [{'num': i, 'name': f'EN - Film number {i} ({1980 + i % 45})', 'stream_type': 'movie', 'stream_id': 500000 + i,
        'stream_icon': '', 'rating': str(round(rnd.uniform(4, 9), 1)), 'rating_5based': 3, 'added': str(1700000000 + i * 60),
        'category_id': vod_cats[i % len(vod_cats)]['category_id'], 'container_extension': 'mp4', 'custom_sid': '',
        'direct_source': ''} for i in range(N_VOD)]
series_cats = [{'category_id': str(i + 1), 'category_name': n, 'parent_id': 0}
               for i, n in enumerate(['Netflix', 'Prime', 'Apple TV+', 'Disney+', 'HBO', 'BBC', 'Turkish', 'Kids', 'Anime', 'Reality'])]
series = [{'num': i, 'name': f'Series number {i} ({1995 + i % 30})', 'series_id': 800000 + i, 'cover': '',
           'plot': 'A series used to test big playlists. ' * 3, 'cast': 'Someone, Someone Else', 'director': '',
           'genre': 'Drama', 'releaseDate': f'{1995 + i % 30}-01-01', 'last_modified': str(1700000000 + i * 60),
           'rating': '7.1', 'category_id': series_cats[i % len(series_cats)]['category_id']} for i in range(N_SERIES)]

blobs = {
    'get_live_categories': json.dumps(live_cats).encode(), 'get_live_streams': json.dumps(live).encode(),
    'get_vod_categories': json.dumps(vod_cats).encode(), 'get_vod_streams': json.dumps(vod).encode(),
    'get_series_categories': json.dumps(series_cats).encode(), 'get_series': json.dumps(series).encode(),
}

def make_guide(path):
    now = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0)
    t0 = now - datetime.timedelta(days=GUIDE_DAYS_BACK)
    hours = (GUIDE_DAYS_BACK + GUIDE_DAYS_AHEAD) * 24
    ids = [s['epg_channel_id'] for s in live[:len(sky)]] + [f'ch{i}.{COUNTRIES[i % len(COUNTRIES)].lower()}' for i in range(N_GUIDE)]
    with open(path, 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="mock">\n')
        for i, cid in enumerate(ids):
            name = sky[i] if i < len(sky) else f'Channel {i - len(sky)}'
            f.write(f'  <channel id="{cid}">\n    <display-name>{name}</display-name>\n    <icon src="" />\n  </channel>\n')
        stamps = [(t0 + datetime.timedelta(hours=h)).strftime('%Y%m%d%H%M%S +0000') for h in range(hours + 1)]
        for i, cid in enumerate(ids):
            rows = []
            for h in range(hours):
                rows.append(f'  <programme start="{stamps[h]}" stop="{stamps[h + 1]}" channel="{cid}">\n'
                            f'    <title lang="en">Programme {h} on {cid}</title>\n'
                            f'    <sub-title>Episode title {h}</sub-title>\n'
                            f'    <category lang="en">{("Drama", "News", "Football", "Documentary")[h % 4]}</category>\n'
                            f'    <episode-num system="xmltv_ns">{h % 5}.{h % 12}.</episode-num>\n'
                            f'    <rating system="BBFC"><value>{("U", "PG", "12", "15")[h % 4]}</value></rating>\n'
                            f'    <desc lang="en">A programme description long enough to look like the real thing, '
                            f'with a sentence or two about what happens &amp; who is in it.</desc>\n  </programme>\n')
            f.write(''.join(rows))
        f.write('</tv>\n')

guide_path = os.path.join(DIR, 'xmltv.xml')
make_guide(guide_path)
print(f'guide {os.path.getsize(guide_path) / 1e6:.0f} MB, films {len(blobs["get_vod_streams"]) / 1e6:.0f} MB', flush=True)

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def send(self, body, ctype='application/json'):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.endswith('/player_api.php'):
            a = q.get('action', '')
            if not a:
                exp = int((datetime.datetime.now() + datetime.timedelta(days=200)).timestamp())
                return self.send(json.dumps({'user_info': {'auth': 1, 'status': 'Active', 'exp_date': str(exp), 'username': q.get('username'),
                                                           'allowed_output_formats': ['m3u8', 'ts']},
                                             'server_info': {'timezone': 'Europe/London', 'url': '10.0.2.2', 'port': str(PORT)}}).encode())
            if a in blobs: return self.send(blobs[a])
            if a in ('get_vod_info', 'get_series_info'): return self.send(b'{"info":{"plot":"Test."},"episodes":{}}')
            if a == 'get_short_epg': return self.send(b'{"epg_listings":[]}')
            return self.send(b'[]')
        if u.path.endswith('/xmltv.php'):
            size = os.path.getsize(guide_path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/xml')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            with open(guide_path, 'rb') as f:
                while True:
                    b = f.read(1 << 20)
                    if not b: break
                    self.wfile.write(b)
            return
        parts = u.path.strip('/').split('/')
        if parts and parts[0] in ('live', 'movie', 'series'):
            target = f'{STATIC}/film.mp4' if parts[0] != 'live' else (f'{STATIC}/live2.ts' if u.path.endswith('.ts') else f'{STATIC}/hls/index.m3u8')
            self.send_response(302)
            self.send_header('Location', target)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(404)
        self.send_header('Content-Length', '0')
        self.end_headers()

ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
