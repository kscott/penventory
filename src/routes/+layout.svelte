<script lang="ts">
	import { resolve } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	<header>
		<h1>Penventory</h1>
		<nav aria-label="Primary">
			<a href={resolve('/')}>Collection</a>
			<a href={resolve('/import')}>Import</a>
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	:root {
		--bg: #eef0ef;
		--surface: #ffffff;
		--surface-2: #f5f6f4;
		--ink: #1b1f2a;
		--ink-soft: #565c6b;
		--accent: #2c3e6b;
		--accent-soft: #dce2f0;
		--amber: #8a5f22;
		--amber-soft: #f3e7d1;
		--moss: #3f6b4e;
		--moss-soft: #dceae0;
		--rose: #8b3a3a;
		--rose-soft: #f2dede;
		--border: #d8d9d2;
		--shadow: 0 1px 2px rgba(27, 31, 42, 0.06), 0 4px 12px rgba(27, 31, 42, 0.05);
		--serif: Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif;
		--sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		--mono: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
	}

	@media (prefers-color-scheme: dark) {
		:root {
			--bg: #14161b;
			--surface: #1d2029;
			--surface-2: #22252f;
			--ink: #e7e5dc;
			--ink-soft: #a4a8b6;
			--accent: #93a7dc;
			--accent-soft: #262b42;
			--amber: #d9a857;
			--amber-soft: #362a17;
			--moss: #7fb08f;
			--moss-soft: #1c2b21;
			--rose: #d98080;
			--rose-soft: #362121;
			--border: #2c2f39;
			--shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.35);
		}
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--ink);
		font-family: var(--sans);
		font-size: 15px;
		line-height: 1.5;
	}

	.app {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 5rem;
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		border-bottom: 1px solid var(--border);
		padding-bottom: 1.5rem;
		margin-bottom: 2rem;
	}

	h1 {
		font-family: var(--serif);
		font-size: 1.6rem;
		margin: 0;
	}

	nav {
		display: flex;
		gap: 1.25rem;
	}

	nav a {
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 0.9rem;
	}

	nav a:hover {
		color: var(--ink);
	}

	@media (max-width: 40rem) {
		header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
