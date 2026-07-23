// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNord from 'starlight-theme-nord'

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'UTMimic Documentation',
			plugins: [starlightThemeNord()],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
			sidebar: [
				{
					label: 'Architecture',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Overview', slug: 'architecture/overview' },
					],
				},
				{
					label: 'Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
			],

		}),
	],
});
