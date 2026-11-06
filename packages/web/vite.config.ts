import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API and Haunting (output feed) requests to the Hono server.
    proxy: {
      '/api': API_TARGET,
      '/h': API_TARGET,
    },
  },
});
