<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<p class="back"><a href={resolve('/import')}>&larr; All import attempts</a></p>

<h2>Attempt #{data.attempt.id} — {data.attempt.content_type}</h2>

<p class="status" class:ready={data.commitEnabled}>
	{#if data.commitEnabled}
		Every row is decided. Ready to commit.
	{:else}
		Some rows still need a decision before this attempt can commit.
	{/if}
</p>

{#if form?.error}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if data.items.length === 0}
	<p class="empty">No flagged rows — every parsed row was clean.</p>
{:else}
	<ul class="items">
		{#each data.items as item (item.id)}
			<li class="item">
				<div class="item-header">
					<span class="flag flag-{item.flagType}">{item.flagType.replaceAll('_', ' ')}</span>
					<span class="line">line {item.sourceLine}</span>
					{#if item.decision}
						<span class="decision">decision: {item.decision}</span>
					{/if}
				</div>

				{#if item.flagType === 'possible_duplicate' && item.candidateInfo?.matches}
					<ul class="matches">
						{#each item.candidateInfo.matches as match (match.id)}
							<li>
								<span class="match-type">{match.matchType}</span>
								match: "{match.freeText}" (similarity {match.similarity.toFixed(2)})
							</li>
						{/each}
					</ul>
				{:else if item.candidateInfo}
					<pre class="candidate-info">{JSON.stringify(item.candidateInfo, null, 2)}</pre>
				{/if}

				<form method="POST" action="?/edit" class="edit-form">
					<input type="hidden" name="itemId" value={item.id} />
					<div class="fields">
						{#each Object.entries(item.raw) as [field, value] (field)}
							<label>
								<span class="field-name">{field}</span>
								<input type="text" name={`raw.${field}`} {value} />
							</label>
						{/each}
					</div>
					<button type="submit" class="save">Save &amp; re-evaluate</button>
				</form>

				{#if item.flagType !== 'needs_confirmation'}
					<form method="POST" action="?/decide" class="decide-form">
						<input type="hidden" name="itemId" value={item.id} />
						<button type="submit" name="decision" value="import" class="import">
							Import anyway
						</button>
						<button type="submit" name="decision" value="skip" class="skip">Skip</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.back {
		margin-top: 0;
	}

	.back a {
		color: #555;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.back a:hover {
		text-decoration: underline;
	}

	.status {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: #f1e6c8;
		color: #6b5300;
		font-size: 0.9rem;
	}

	.status.ready {
		background: #d9f0dc;
		color: #16612b;
	}

	.error {
		color: #a4241c;
		border: 1px solid #eec7c2;
		background: #fdf1f0;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
	}

	.empty {
		color: #666;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.item {
		border: 1px solid #ddd;
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	.item-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.flag {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: #eee;
		color: #444;
	}

	.flag-possible_duplicate {
		background: #f1e6c8;
		color: #6b5300;
	}

	.flag-unparseable_nib,
	.flag-unparseable_row {
		background: #f6d8d5;
		color: #8a241c;
	}

	.flag-needs_confirmation {
		background: #d7e3f6;
		color: #1c4c8a;
	}

	.line {
		color: #888;
		font-size: 0.875rem;
	}

	.decision {
		margin-left: auto;
		font-size: 0.875rem;
		font-weight: 600;
		color: #16612b;
	}

	.matches {
		margin: 0.25rem 0 0.75rem;
		padding-left: 1.25rem;
		font-size: 0.9rem;
		color: #444;
	}

	.match-type {
		font-weight: 600;
	}

	.candidate-info {
		background: #f7f7f7;
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		overflow-x: auto;
	}

	.edit-form {
		margin-top: 0.75rem;
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.6rem 0.75rem;
		margin-bottom: 0.75rem;
	}

	.fields label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.8rem;
		color: #555;
	}

	.field-name {
		font-weight: 600;
		color: #333;
	}

	.fields input {
		padding: 0.35rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	button {
		border: 1px solid #ccc;
		border-radius: 6px;
		padding: 0.4rem 0.85rem;
		font-size: 0.875rem;
		background: #fff;
		cursor: pointer;
	}

	button.save {
		border-color: #999;
	}

	button:hover {
		background: #f5f5f5;
	}

	.decide-form {
		margin-top: 0.6rem;
		display: flex;
		gap: 0.5rem;
	}

	button.import {
		border-color: #3d8b52;
		color: #1e5b30;
	}

	button.skip {
		color: #666;
	}
</style>
