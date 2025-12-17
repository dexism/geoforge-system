import { resolve } from 'path'

/** @type {import('vite').UserConfig} */
export default {
  root: './src',
  base: './',
  // publicDir: '../src/public', // Points to src/public relative to src? (Removed for duplicate warning)
  // Wait. If root is ./src, then relative paths in index.html are relative to ./src.
  // publicDir is handled by Vite to copy files to dist or serve them at root.
  // If I want src/public/map to be available at /map,
  // I must tell Vite that the public dir is src/public.
  // "publicDir" is relative to "project root".
  // If "root" option is set to "./src", then "project root" is "./src" ??
  // Let's assume yes.
  // So publicDir: './public' -> src/public.

  // BUT the user said "Can't start". And default was likely implicit (public).
  // If default didn't work, maybe implicit wasn't src/public.

  // Let's try explicit absolute path resolution to be 100% sure.
  publicDir: resolve(process.cwd(), 'src/public'),

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // ここにビルドしたいHTMLページを定義します
        rulebook: resolve(process.cwd(), 'src/rulebook.html'),
        main: resolve(process.cwd(), 'src/index.html'),
        // entrysheet: resolve(process.cwd(), 'src/entrysheet.html'),
      }
    }
  },
  define: {
    '__APP_VERSION__': JSON.stringify(process.env.npm_package_version)
  }
}