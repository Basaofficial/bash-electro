// Kopira web aplikaciju u www/ (webDir za Capacitor).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
const OUT = 'www';
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'icons', 'css', 'js'];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) if (existsSync(f)) cpSync(f, `${OUT}/${f}`, { recursive: true });
console.log('www/ spreman:', FILES.join(', '));
