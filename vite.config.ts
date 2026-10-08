import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// sql.js is a UMD/CommonJS browser build. It must be INCLUDED in optimizeDeps
// (not excluded) or the `default` export breaks at runtime. The wasm is loaded
// via `import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'` + locateFile in db.ts.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  optimizeDeps: {
    include: ['sql.js'],
  },
})
