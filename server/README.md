# Orbit Server

A small companion server for Orbit TV. It runs on an always-on machine at home, such as a NAS, a Raspberry Pi or a spare PC.

- **Records** live channels on a schedule using ffmpeg. You can set recordings from any device, including phones and Fire TV.
- **Plays recordings back** on every device. Finished recordings are converted to MP4 so iPhones can play them too.
- **Syncs** profiles, favourites, playlists, resume points and settings between your devices.

## Run with Docker

1. Edit `docker-compose.yml` and set `ORBIT_TOKEN` to a long random secret (for example, the output of `openssl rand -hex 16`).
2. Start the server:
   ```bash
   docker compose up -d --build
   ```
3. Open `http://<server-ip>:8090` in a browser to check it is running.
4. In Orbit TV, go to **Settings → Orbit Server**. Enter `http://<server-ip>:8090` and the same token.

Recordings are saved in `./data/recordings`.

## Run without Docker

You need Node.js 18+ and ffmpeg.

```bash
ORBIT_TOKEN=your-secret node orbit-server.js
```

| Variable | Default | Meaning |
|---|---|---|
| `ORBIT_TOKEN` | required | Shared secret entered in the app |
| `PORT` | 8090 | HTTP port |
| `DATA_DIR` | `./data` | Where recordings and state are kept |
| `PAD_BEFORE` / `PAD_AFTER` | 1 / 3 | Minutes recorded before the programme starts and after it ends |
| `MAX_DAYS` | 0 | Delete recordings after this many days (0 keeps them) |
| `FFMPEG` | `ffmpeg` | Path to ffmpeg |

## Security notes

- The server has no HTTPS of its own. Keep it on your home network.
- To use it away from home, put it behind a VPN such as Tailscale, or behind an HTTPS reverse proxy.
- Anyone with the token can read your synced playlists, which include logins. Keep the token secret.
