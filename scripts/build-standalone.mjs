// Bundles public/ into one self-contained HTML file (dist/feynman-tutor.html),
// e.g. for hosting as a single page or publishing as a claude.ai artifact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = p => fs.readFileSync(path.join(root, 'public', p), 'utf8');
const order = ['prompt.js', 'protocol.js', 'stage.js', 'voice.js', 'brain.js', 'app.js'];

const js = order.map(f => `// ---- ${f} ----\n` + pub('js/' + f)
  .replace(/^import .*?;\s*$/gm, '')
  .replace(/^export (const|class|function|async function) /gm, '$1 ')).join('\n');

let html = pub('index.html')
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="stylesheet" href="styles.css">/, () => `<style>\n${pub('styles.css')}\n</style>`)
  .replace(/<script type="module" src="js\/app.js"><\/script>/, () => `<script type="module">\n${js}\n</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'feynman-tutor.html');
fs.writeFileSync(out, html);
console.log('wrote', path.relative(root, out), (html.length / 1024).toFixed(1) + ' KB');
