import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// in dev the API (/api, one origin in production) is the viz-web server
export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
