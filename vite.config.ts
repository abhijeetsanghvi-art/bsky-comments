import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({ 
      insertTypesEntry: true,
      include: ['src/bsky-comments.ts']
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/bsky-comments.ts'),
      name: 'BskyComments',
      fileName: 'bsky-comments',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
