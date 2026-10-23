import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
let commit = process.env.GITHUB_SHA || 'local';
if (commit === 'local') { try { commit = execSync('git rev-parse HEAD', { stdio: ['ignore','pipe','ignore'] }).toString().trim(); } catch { /* A fresh uncommitted checkout is a local build. */ } }
export default defineConfig({plugins:[react(),{name:'build-manifest',generateBundle(){this.emitFile({type:'asset',fileName:'build.json',source:JSON.stringify({commit,app:'juryflow',schemaVersion:1})});}}],base:'./',test:{include:['tests/**/*.test.ts']}});
