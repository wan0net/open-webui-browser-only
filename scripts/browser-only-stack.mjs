import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'browser-only-stack.json'), 'utf8'));
const base = manifest.upstream.baseCommit;

const run = (command, args, options = {}) =>
	execFileSync(command, args, {
		cwd: options.cwd ?? root,
		encoding: options.capture ? 'utf8' : undefined,
		stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		env: { ...process.env, ...options.env }
	});

const capture = (command, args, cwd = root) => run(command, args, { cwd, capture: true }).trim();
const matches = (path, exact, prefixes) =>
	exact.includes(path) || prefixes.some((p) => path.startsWith(p));

function assertBase() {
	try {
		run('git', ['merge-base', '--is-ancestor', base, 'HEAD']);
	} catch {
		throw new Error(`Pinned upstream base ${base} is not an ancestor of HEAD`);
	}
}

function boundary() {
	assertBase();
	const entries = capture('git', ['diff', '--name-status', `${base}..HEAD`])
		.split('\n')
		.filter(Boolean);
	const violations = [];
	let modified = 0;
	let added = 0;

	for (const entry of entries) {
		const [status, ...pathParts] = entry.split('\t');
		const path = pathParts.at(-1);
		if (status === 'M') {
			modified += 1;
			if (!matches(path, manifest.allowedModifiedPaths, manifest.allowedModifiedPrefixes)) {
				violations.push(`${status}\t${path}`);
			}
		} else if (status === 'A') {
			added += 1;
			if (!matches(path, manifest.allowedAddedPaths, manifest.allowedAddedPrefixes)) {
				violations.push(`${status}\t${path}`);
			}
		} else {
			violations.push(`${status}\t${path}`);
		}
	}

	if (violations.length) {
		throw new Error(
			`Browser-only patch boundary changed. Review and explicitly update browser-only-stack.json:\n${violations.join('\n')}`
		);
	}
	console.log(
		`Patch boundary OK: ${modified} upstream files modified, ${added} browser-only files added.`
	);
}

function prepareOutput(output) {
	if (statSafe(output)) {
		if (readdirSync(output).length !== 0)
			throw new Error(`Output directory is not empty: ${output}`);
	} else {
		mkdirSync(output, { recursive: true });
	}
}

function statSafe(path) {
	try {
		return statSync(path);
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

function exportPatches(output) {
	assertBase();
	prepareOutput(output);
	run('git', ['format-patch', '--no-signature', '--output-directory', output, `${base}..HEAD`]);
	const count = readdirSync(output).filter((file) => file.endsWith('.patch')).length;
	console.log(`Exported ${count} patches to ${output}`);
}

function latestStableTag() {
	const refs = capture('git', ['ls-remote', '--tags', '--refs', manifest.upstream.url]);
	const versions = refs
		.split('\n')
		.map((line) => line.match(/refs\/tags\/(v?(\d+)\.(\d+)\.(\d+))$/))
		.filter(Boolean)
		.map((match) => ({ tag: match[1], parts: match.slice(2).map(Number) }));
	versions.sort((a, b) => {
		for (let i = 0; i < 3; i += 1) {
			if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
		}
		return 0;
	});
	if (!versions.length) throw new Error('Could not find a stable semantic-version tag upstream');
	return versions[0].tag;
}

function trialApply(requestedTarget, verify) {
	assertBase();
	boundary();
	const target = requestedTarget === 'latest-stable' ? latestStableTag() : requestedTarget;
	const temporary = mkdtempSync(join(tmpdir(), 'open-webui-browser-only-'));
	const patches = join(temporary, 'patches');
	const worktree = join(temporary, 'worktree');
	const checkRef = 'refs/browser-only-check/upstream';

	try {
		exportPatches(patches);
		console.log(`Fetching upstream target ${target}`);
		run('git', ['fetch', '--no-tags', '--force', manifest.upstream.url, `+${target}:${checkRef}`]);
		run('git', ['worktree', 'add', '--detach', worktree, checkRef]);
		const patchFiles = readdirSync(patches)
			.filter((file) => file.endsWith('.patch'))
			.sort()
			.map((file) => join(patches, file));
		run('git', ['am', '--3way', ...patchFiles], { cwd: worktree });
		console.log(`Patch stack applies cleanly to ${target}.`);

		if (verify) {
			run('npm', ['ci'], { cwd: worktree });
			run('npm', ['run', 'test:browser-only:contracts'], { cwd: worktree });
			run('npm', ['run', 'build:static'], {
				cwd: worktree,
				env: { BASE_PATH: '/browser-only-smoke', NODE_OPTIONS: '--max-old-space-size=8192' }
			});
			run('npm', ['run', 'test:browser-only:smoke'], {
				cwd: worktree,
				env: { BROWSER_ONLY_BASE_PATH: '/browser-only-smoke' }
			});
		}
	} finally {
		try {
			run('git', ['worktree', 'remove', '--force', worktree]);
		} catch {
			// The worktree may not have been created.
		}
		rmSync(temporary, { recursive: true, force: true });
	}
}

const [command = 'boundary', argument, ...flags] = process.argv.slice(2);

try {
	if (command === 'boundary') boundary();
	else if (command === 'export') exportPatches(resolve(root, argument ?? 'browser-only-patches'));
	else if (command === 'check') {
		trialApply(argument ?? manifest.upstream.defaultTarget, flags.includes('--verify'));
	} else {
		throw new Error(
			'Usage: browser-only-stack.mjs boundary | export [directory] | check [ref] [--verify]'
		);
	}
} catch (error) {
	console.error(error.message ?? error);
	process.exitCode = 1;
}
