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
					label: 'Modules',
					items: [
						{ label: 'Database', slug: 'modules/database' },
						{ label: 'Documentation', slug: 'modules/documentation' },
						{ label: 'Drone Registrations Service', slug: 'modules/drone_registrations_service' },
						{ label: 'Flight Authorizations Service', slug: 'modules/flight_authorizations_service' },
						{ label: 'Live Flight Log Service', slug: 'modules/live_flight_log_service' },
						{ label: 'Sensor Array Simulator', slug: 'modules/sensor_array_simulator' },
						{ label: 'Sensor Flight Log Service', slug: 'modules/sensor_flight_log_service' },
						{ label: 'Weather Service', slug: 'modules/weather_service' },
					],
				},
				{
					label: 'Implementation Plans',
					items: [
						// { label: 'Database', slug: 'modules/database' },
						// { label: 'Documentation', slug: 'modules/documentation' },
						{ label: 'Drone Registrations Service', slug: 'plans/drone_registrations_service_plan' },
						// { label: 'Flight Authorizations Service', slug: 'modules/flight_authorizations_service' },
						{ label: 'Live Flight Log Service', slug: 'plans/live_flight_log_service_plan' },
						// { label: 'Sensor Array Simulator', slug: 'modules/sensor_array_simulator' },
						{ label: 'Sensor Flight Log Service', slug: 'plans/sensor_flight_log_service_plan' },
						{ label: 'Weather Service', slug: 'plans/weather_service_plan' },
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
