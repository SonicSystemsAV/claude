import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// A short build stamp (git hash + commit time) baked in at build/dev-server
// start, surfaced in the app footer so you can confirm a refresh actually moved
// you to the latest code. Falls back gracefully when git isn't available.
function gitInfo(): { rev: string; time: string } {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      return ''
    }
  }
  // NB: the --date format contains a space, so it MUST be quoted or the shell
  // splits it into a second argument and git errors out.
  return {
    rev: run('git rev-parse --short HEAD') || 'unknown',
    time: run('git log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M"'),
  }
}
const { rev, time } = gitInfo()

// sql.js is a UMD/CommonJS browser build. It must be INCLUDED in optimizeDeps
// (not excluded) or the `default` export breaks at runtime. The wasm is loaded
// via `import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'` + locateFile in db.ts.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  define: {
    __BUILD_REV__: JSON.stringify(rev),
    __BUILD_TIME__: JSON.stringify(time),
  },
  optimizeDeps: {
    include: ['sql.js'],
  },
})
