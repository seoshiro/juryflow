// Harness-only adaptation of the original independent audit oracle.
// The oracle body, seed, generated cases and assertions are preserved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(source, 'test-results', 'independent-oracle');
fs.mkdirSync(out, { recursive: true });
const compiled = new Set();
function compile(from) {
  if (compiled.has(from)) return;
  compiled.add(from);
  let code = ts.transpileModule(fs.readFileSync(path.join(source, from), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  code = code.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, specifier) => {
    const candidate = path.join(path.dirname(from), specifier);
    const dependency = [candidate + '.ts', candidate + '.tsx', path.join(candidate, 'index.ts')].find(p => fs.existsSync(path.join(source, p)));
    if (!dependency) throw new Error(`Oracle harness could not resolve ${from}: ${specifier}`);
    compile(dependency);
    const relative = path.relative(path.dirname(from), dependency).replace(/\\/g, '/').replace(/\.tsx?$/, '.mjs');
    return `from ${quote}${relative.startsWith('.') ? relative : './' + relative}${quote}`;
  });
  const target = path.join(out, from.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code);
}
for (const from of ['src/engine/index.ts', 'src/io.ts', 'src/demo.ts']) compile(from);
const engine = await import(pathToFileURL(path.join(out, 'src/engine/index.mjs')).href);
const io = await import(pathToFileURL(path.join(out, 'src/io.mjs')).href);
const { solve, validateSchedule, validateProject } = engine;
const { parseDocument, restoreDraft, serializeDocument, exportICS, slotLabel } = io;
export { fs, path, out, solve, validateSchedule, validateProject, parseDocument, restoreDraft, serializeDocument, exportICS, slotLabel };
