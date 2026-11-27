const path = require('node:path');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  root: __dirname,
  server: {
    proxy: {
      '/api': {
        target: process.env.APPURBE_API_URL || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true
  }
});
