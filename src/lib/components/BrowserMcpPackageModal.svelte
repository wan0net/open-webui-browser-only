<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { v4 as uuidv4 } from 'uuid';
	import Modal from '$lib/components/common/Modal.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { discoverMcpPackageServer } from '$lib/virtual-backend/mcp-package-runtime';

	export let show = false;
	export let edit = false;
	export let connection: any = null;
	export let onSubmit: (connection: any) => void | Promise<void> = () => {};
	export let onDelete: () => void | Promise<void> = () => {};

	let packageInput = '';
	let name = '';
	let description = '';
	let registryUrl = 'https://esm.sh';
	let argsText = '[]';
	let envText = '{}';
	let enable = true;
	let loading = false;
	let initializedFor: any = null;

	const inputClass =
		'w-full bg-transparent text-sm outline-hidden placeholder:text-gray-300 dark:placeholder:text-gray-700';

	const tokenize = (input: string) => {
		const values: string[] = [];
		let value = '';
		let quote = '';
		let escaped = false;
		for (const character of input.trim()) {
			if (escaped) {
				value += character;
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (quote) {
				if (character === quote) quote = '';
				else value += character;
			} else if (character === '"' || character === "'") {
				quote = character;
			} else if (/\s/.test(character)) {
				if (value) values.push(value);
				value = '';
			} else value += character;
		}
		if (quote) throw new Error('The package command contains an unfinished quote.');
		if (value) values.push(value);
		return values;
	};

	const parsePackageInput = () => {
		const tokens = tokenize(packageInput);
		if (tokens.length === 0) throw new Error('Enter a package name or npx command.');
		let start = 0;
		if (tokens[0].split(/[\\/]/).at(-1)?.toLowerCase() === 'npx') start = 1;
		else if (tokens[0].split(/[\\/]/).at(-1)?.toLowerCase() === 'npm' && tokens[1] === 'exec') {
			start = 2;
		}
		while (['-y', '--yes', '--quiet', '-q', '--'].includes(tokens[start])) start += 1;
		let packageName = tokens[start];
		if (packageName === '--package' || packageName === '-p') packageName = tokens[++start];
		if (packageName?.startsWith('--package=')) packageName = packageName.slice(10);
		if (!packageName || packageName.startsWith('-'))
			throw new Error('Could not find a package name.');
		const commandArgs = tokens.slice(start + 1);
		const explicitArgs = JSON.parse(argsText || '[]');
		if (!Array.isArray(explicitArgs) || !explicitArgs.every((item) => typeof item === 'string')) {
			throw new Error('Arguments must be a JSON array of strings.');
		}
		const env = JSON.parse(envText || '{}');
		if (!env || typeof env !== 'object' || Array.isArray(env)) {
			throw new Error('Environment must be a JSON object.');
		}
		if (!Object.values(env).every((item) => typeof item === 'string')) {
			throw new Error('Environment values must be strings.');
		}
		return { packageName, args: commandArgs.length ? commandArgs : explicitArgs, env };
	};

	const buildConnection = () => {
		const parsed = parsePackageInput();
		return {
			type: 'mcp_package',
			url: connection?.url ?? `browser-mcp:${uuidv4()}`,
			package_name: parsed.packageName,
			registry_url: registryUrl,
			args: parsed.args,
			env: parsed.env,
			config: { enable },
			info: {
				id: connection?.info?.id ?? '',
				name: name || parsed.packageName,
				description
			}
		};
	};

	const verify = async () => {
		loading = true;
		try {
			const data = await discoverMcpPackageServer(buildConnection());
			toast.success(`Browser MCP package started with ${data.specs.length} tool(s).`);
			return true;
		} catch (error: any) {
			toast.error(error?.message ?? String(error));
			return false;
		} finally {
			loading = false;
		}
	};

	const submit = async () => {
		if (!(await verify())) return;
		await onSubmit(buildConnection());
		show = false;
	};

	const initialize = () => {
		if (initializedFor === connection && (edit || initializedFor !== null)) return;
		initializedFor = connection;
		packageInput = connection?.package_name ?? '';
		name = connection?.info?.name ?? '';
		description = connection?.info?.description ?? '';
		registryUrl = connection?.registry_url ?? 'https://esm.sh';
		argsText = JSON.stringify(connection?.args ?? [], null, 2);
		envText = JSON.stringify(connection?.env ?? {}, null, 2);
		enable = connection?.config?.enable ?? true;
	};

	$: if (show) initialize();
</script>

<Modal size="sm" bind:show>
	<div class="px-5 pt-4 pb-5 text-sm dark:text-gray-100">
		<div class="mb-4 flex items-center justify-between">
			<h1 class="text-lg font-medium">
				{edit ? 'Edit Browser MCP Package' : 'Add Browser MCP Package'}
			</h1>
			<button aria-label="Close" type="button" on:click={() => (show = false)}
				><XMark className="size-5" /></button
			>
		</div>

		<form class="flex flex-col gap-3" on:submit|preventDefault={submit}>
			<div>
				<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-package"
					>Package or npx command</label
				>
				<input
					id="browser-mcp-package"
					class={inputClass}
					bind:value={packageInput}
					placeholder="npx -y @example/mcp-server"
					required
					autocomplete="off"
				/>
			</div>

			<div>
				<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-name">Name</label>
				<input
					id="browser-mcp-name"
					class={inputClass}
					bind:value={name}
					placeholder="Optional display name"
					autocomplete="off"
				/>
			</div>

			<div>
				<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-description"
					>Description</label
				>
				<input
					id="browser-mcp-description"
					class={inputClass}
					bind:value={description}
					placeholder="Optional"
					autocomplete="off"
				/>
			</div>

			<details class="rounded-lg border border-gray-100 p-3 dark:border-gray-850">
				<summary class="cursor-pointer text-xs text-gray-500">Advanced runtime settings</summary>
				<div class="mt-3 flex flex-col gap-3">
					<div>
						<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-registry"
							>ESM registry</label
						>
						<input
							id="browser-mcp-registry"
							class={inputClass}
							bind:value={registryUrl}
							required
							autocomplete="off"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-args"
							>Arguments (JSON array)</label
						>
						<textarea
							id="browser-mcp-args"
							class="{inputClass} min-h-16 font-mono"
							bind:value={argsText}
						></textarea>
					</div>
					<div>
						<label class="mb-1 block text-xs text-gray-500" for="browser-mcp-env"
							>Environment (JSON object, stored in this browser)</label
						>
						<textarea
							id="browser-mcp-env"
							class="{inputClass} min-h-20 font-mono"
							bind:value={envText}
						></textarea>
					</div>
				</div>
			</details>

			<div class="flex items-center justify-between">
				<div>
					<div class="text-xs text-gray-600 dark:text-gray-400">Enabled</div>
					<div class="text-[0.6875rem] text-gray-400">Runs only in an isolated browser Worker.</div>
				</div>
				<Switch bind:state={enable} />
			</div>

			<div
				class="rounded-lg bg-yellow-50 p-2.5 text-[0.6875rem] text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200"
			>
				This is a limited Node-like shim, not Node.js. Packages needing native modules,
				subprocesses, real files, sockets, or unrestricted network access will not work.
			</div>

			<div class="mt-1 flex items-center justify-between">
				{#if edit}
					<button
						class="text-xs text-red-600 hover:underline"
						type="button"
						on:click={() => onDelete()}>Delete</button
					>
				{:else}<span></span>{/if}
				<div class="flex items-center gap-2">
					<button
						class="rounded-full px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-850"
						type="button"
						disabled={loading}
						on:click={verify}>Test</button
					>
					<button
						class="flex min-w-16 items-center justify-center rounded-full bg-black px-3.5 py-1.5 text-white dark:bg-white dark:text-black"
						type="submit"
						disabled={loading}
					>
						{#if loading}<Spinner className="size-4" />{:else}Save{/if}
					</button>
				</div>
			</div>
		</form>
	</div>
</Modal>
