// Turn the raw captures of scripts/readme/capture.mjs into README assets in docs/assets/readme/:
// screenshots → 1600px WebP; screencast frames → demo.webp (animated, 1200px) and demo.gif (960px fallback);
// optionally an MP4 for a video upload elsewhere. Needs ffmpeg, cwebp and img2webp (libwebp) on PATH.
//   node scripts/readme/build-assets.mjs <raw-dir> [--mp4 <file>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RAW = resolve(process.argv[2] ?? 'readme-raw');
const mp4Arg = process.argv.indexOf('--mp4');
const MP4 = mp4Arg > 0 ? resolve(process.argv[mp4Arg + 1]) : null;
const OUT = resolve(import.meta.dirname, '../../docs/assets/readme');
mkdirSync(OUT, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;

for (const f of readdirSync(RAW).filter((x) => x.endsWith('.png'))) {
  const out = join(OUT, f.replace(/\.png$/, '.webp'));
  run('cwebp', ['-quiet', '-q', '86', '-resize', '1600', '0', join(RAW, f), '-o', out]);
  console.log(out, kb(out));
}

// screencast frames arrive only when the screen changes: give each frame its real duration, then resample
const FR = join(RAW, 'frames');
const times = JSON.parse(readFileSync(join(FR, 'times.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'litpage-anim-'));
let list = 'ffconcat version 1.0\n';
times.forEach((t, i) => {
  const next = times[i + 1] ?? t + 1.5;
  list += `file '${join(FR, `${String(i).padStart(4, '0')}.jpg`)}'\nduration ${Math.max(0.02, next - t).toFixed(3)}\n`;
});
list += `file '${join(FR, `${String(times.length - 1).padStart(4, '0')}.jpg`)}'\n`;
writeFileSync(join(work, 'list.txt'), list);
const FPS = 12;
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'),
  '-vf', `fps=${FPS},scale=1200:-2:flags=lanczos`, join(work, 'f%04d.png')]);
const pngs = readdirSync(work).filter((x) => /^f\d+\.png$/.test(x)).sort();
const delay = String(Math.round(1000 / FPS));
const webp = join(OUT, 'demo.webp');
run('img2webp', ['-loop', '0', '-lossy', '-q', '72', '-m', '4', ...pngs.flatMap((p) => ['-d', delay, join(work, p)]), '-o', webp]);
console.log(webp, kb(webp), `${pngs.length} frames`);
const gif = join(OUT, 'demo.gif');
run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(work, 'f%04d.png'), '-vf',
  'scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop', '0', gif]);
console.log(gif, kb(gif));
if (MP4) {
  run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(work, 'f%04d.png'), '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', MP4]);
  console.log(MP4, kb(MP4));
}
