import { resolve } from 'path'

/** @type {import('vite').UserConfig} */
export default {
  root: './src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // ここにビルドしたいHTMLページを定義します
        rulebook: resolve(__dirname, 'src/rulebook.html'),        
        main: resolve(__dirname, 'src/index.html'),
      }
    }
  }
}