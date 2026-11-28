import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Addons import from 'three'; point that at the WebGPU build so the bundle
// carries one renderer (WebGPURenderer with its WebGL2 backend), not two.
export default defineConfig({
  resolve: {
    alias: [{ find: /^three$/, replacement: fileURLToPath(new URL('./node_modules/three/build/three.webgpu.js', import.meta.url)) }],
  },
  build: { chunkSizeWarningLimit: 1200 },
});
