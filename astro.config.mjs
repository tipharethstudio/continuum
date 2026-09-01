import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

const basePath = (process.env.BASE_PATH ?? '/').replace(/\/+$/, '') || '/';

export default defineConfig({
  site: 'https://tiphareth.com.br',
  base: basePath,
  integrations: [mdx()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      theme: 'catppuccin-mocha',
    },
  },
});
