// The page a phone sees after scanning the QR code on the TV. It is served by the TV itself
// (OrbitPlayerPlugin.startPairing), so it has to be one self-contained HTML string.
// The TV swaps <!--STATE--> for "form" or "sent".
export const PHONE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Add a playlist to Orbit TV</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f5f6ff;
background:linear-gradient(165deg,#262a54,#3a3f78 55%,#2a2e5c);min-height:100vh;padding:28px 18px}
main{max-width:460px;margin:0 auto}h1{font-size:26px;margin:0 0 6px}p{color:#c6caf0;margin:0 0 22px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.tabs label{flex:1;min-width:120px}
.tabs input{display:none}.tabs span{display:block;text-align:center;padding:11px 10px;border-radius:99px;background:#ffffff1f;font-weight:600}
.tabs input:checked+span{background:#52d4f8;color:#0b2340}
.f{display:none}.f.on{display:block}
label.l{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}
input.i{width:100%;padding:14px;border-radius:12px;border:2px solid #ffffff14;background:#ffffff24;color:#fff;font-size:16px}
input.i:focus{outline:0;border-color:#52d4f8}
button{margin-top:22px;width:100%;padding:15px;border:0;border-radius:99px;background:#2f6fe0;color:#fff;font-size:17px;font-weight:700}
.done{display:none;text-align:center;padding-top:40px}.done b{font-size:46px;display:block}
.sent .done{display:block}.sent form{display:none}
</style></head><body class="<!--STATE-->"><main>
<form method="post">
<h1>Add a playlist</h1><p>Type the details from your TV provider. They go straight to your TV.</p>
<div class="tabs">
<label><input type="radio" name="type" value="xtream" checked><span>Xtream Codes</span></label>
<label><input type="radio" name="type" value="m3u"><span>M3U link</span></label>
<label><input type="radio" name="type" value="stalker"><span>MAC portal</span></label>
</div>
<div class="f on" data-t="xtream">
<label class="l">Server address</label><input class="i" name="server" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="http://example.com:8080">
<label class="l">Username</label><input class="i" name="user" autocapitalize="off" autocorrect="off">
<label class="l">Password</label><input class="i" name="pass" type="password">
</div>
<div class="f" data-t="m3u"><label class="l">Playlist link</label><input class="i" name="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="http://…"></div>
<div class="f" data-t="stalker">
<label class="l">Portal address</label><input class="i" name="portal" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="http://portal.example.com/c/">
<label class="l">MAC address</label><input class="i" name="mac" autocapitalize="characters" placeholder="00:1A:79:12:34:56">
</div>
<label class="l">Name (optional)</label><input class="i" name="name" placeholder="My TV">
<button type="submit">Send to TV</button>
</form>
<div class="done"><b>✓</b><h1>Sent to your TV</h1><p>Your channels will appear on the TV in a moment. You can close this page.</p></div>
</main><script>
document.querySelectorAll('input[name=type]').forEach(function(r){r.onchange=function(){
document.querySelectorAll('.f').forEach(function(f){f.classList.toggle('on',f.dataset.t===r.value)})}});
</script></body></html>`;
