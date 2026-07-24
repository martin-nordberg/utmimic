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
						{ label: 'Overview', slug: 'architecture/overview' },
					],
				},
				{
					label: 'Components',
					items: [
						{ label: 'Database', slug: 'modules/database' },
						{ label: 'Documentation', slug: 'modules/documentation' },
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
