// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
	site: 'https://example.com',
	output: 'hybrid',
	adapter: netlify(),
	integrations: [mdx(), sitemap()],
});
