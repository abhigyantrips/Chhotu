import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig, fontProviders } from "astro/config";

export default defineConfig({
	site: "https://chhotu.abhi.now",
	output: "server",
	adapter: cloudflare({ imageService: "compile" }),
	integrations: [
		AstroPWA({
			strategies: "generateSW",
			registerType: "prompt",
			injectRegister: false,
			filename: "sw.js",
			manifestFilename: "manifest.webmanifest",
			// Keep both Astro's directory URLs and their clean route aliases offline.
			experimental: { directoryAndTrailingSlashHandler: true },
			manifest: {
				id: "/",
				name: "chhotu",
				short_name: "chhotu",
				description: "a little helper to help me with website shenanigans.",
				start_url: "/",
				scope: "/",
				display: "standalone",
				background_color: "#1d2021",
				theme_color: "#1d2021",
				icons: [
					{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
					{ src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
					{
						src: "/pwa/maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
				shortcuts: [
					{
						name: "write a snippet",
						url: "/snippets",
						icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }],
					},
				],
			},
			workbox: {
				cacheId: "chhotu",
				globPatterns: ["**/*.{html,js,css,woff2,svg,png,ico}"],
				cleanupOutdatedCaches: true,
				clientsClaim: true,
				skipWaiting: false,
				// Cache only the generated public assets. Auth, APIs, and unknown routes
				// must reach the server, including when navigating while offline.
				navigateFallback: null,
				runtimeCaching: [],
			},
		}),
	],
	session: { driver: { entrypoint: "unstorage/drivers/null" } },
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: "Sour Gummy",
			cssVariable: "--font-gummy",
			weights: [400, 600],
			styles: ["normal", "italic"],
			formats: ["woff2"],
		},
	],
	// Keep small scripts external so the self-only script CSP also covers PWA setup.
	vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
});
