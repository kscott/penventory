<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="intro">
	<h2>Start an import</h2>
	<p>
		One file at a time. Pens, inks, and inkings are independent — each gets its own attempt, worked
		through and committed on its own schedule.
	</p>
</div>

{#if form?.error}
	<p class="error" role="alert">{form.error}</p>
{/if}

<ul class="upload-types">
	{#each data.uploadTypes as type (type.key)}
		<li class="upload-row">
			<span class="type-label">{type.label}</span>
			{#if type.status === 'coming_soon'}
				<span class="badge coming-soon">Coming soon</span>
			{:else if type.openAttemptId !== null}
				<a
					class="badge already-open"
					href={resolve('/import/[attemptId]', { attemptId: String(type.openAttemptId) })}
				>
					Already open — continue reviewing
				</a>
			{:else}
				<form method="POST" action="?/upload" enctype="multipart/form-data">
					<input type="hidden" name="contentType" value={type.key} />
					<input type="file" name="file" accept=".csv,text/csv" required />
					<button type="submit">Upload</button>
				</form>
			{/if}
		</li>
	{/each}
</ul>

<div class="intro">
	<h2>Import attempts</h2>
	<p>
		Open uploads waiting on a decision. Once every row is decided and committed, it drops off this
		list.
	</p>
</div>

{#if data.attempts.length === 0}
	<p class="empty">No open import attempts.</p>
{:else}
	<ul class="attempts">
		{#each data.attempts as attempt (attempt.id)}
			<li>
				<a href={resolve('/import/[attemptId]', { attemptId: String(attempt.id) })}>
					<span class="id">#{attempt.id}</span>
					<span class="op">{attempt.content_type}</span>
					<span class="created">{attempt.created_at.toLocaleString()}</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro {
		margin-bottom: 1.75rem;
	}

	.intro h2 {
		font-family: var(--serif);
		font-size: 1.3rem;
		margin: 0 0 0.35rem;
	}

	.intro p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	.error {
		color: var(--rose);
		border: 1px solid var(--border);
		background: var(--rose-soft);
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		margin-bottom: 1rem;
	}

	.empty {
		color: var(--ink-soft);
	}

	.upload-types {
		list-style: none;
		margin: 0 0 2.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.upload-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 1.1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow);
	}

	.type-label {
		font-weight: 600;
		min-width: 8rem;
	}

	.upload-row form {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-left: auto;
	}

	.badge {
		margin-left: auto;
		font-size: 0.82rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
	}

	.badge.coming-soon {
		background: var(--surface-2);
		color: var(--ink-soft);
	}

	a.badge.already-open {
		background: var(--amber-soft);
		color: var(--amber);
		text-decoration: none;
	}

	a.badge.already-open:hover {
		text-decoration: underline;
	}

	.attempts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.attempts a {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.85rem 1.1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow);
		text-decoration: none;
		color: var(--ink);
	}

	.attempts a:hover {
		border-color: var(--accent);
	}

	.id {
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--accent);
	}

	.op {
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	.created {
		margin-left: auto;
		font-family: var(--mono);
		color: var(--ink-soft);
		font-size: 0.78rem;
	}
</style>
