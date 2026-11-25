// Copies the player libraries into src/vendor so the same web code runs in Electron, Android and iOS.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'src', 'vendor');
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of [['hls.js/dist/hls.min.js', 'hls.min.js'], ['mpegts.js/dist/mpegts.js', 'mpegts.js']]) {
  const src = path.join(root, 'node_modules', from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, to));
}
