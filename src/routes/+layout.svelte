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
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.app {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		border-bottom: 1px solid #ccc;
		padding-bottom: 1rem;
		margin-bottom: 1rem;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0;
	}

	nav {
		display: flex;
		gap: 1rem;
	}

	@media (max-width: 40rem) {
		header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
