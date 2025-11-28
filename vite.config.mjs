import { resolve } from 'path'

/** @type {import('vite').UserConfig} */
export default {
  root: './src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // ここにビルドしたいHTMLページを定義します
        rulebook: resolve(process.cwd(), 'src/rulebook.html'),        
        main: resolve(process.cwd(), 'src/index.html'),
      }
    }
  }
}