import { beforeAll, describe, expect, it } from 'vitest';
import { init } from 'es-module-lexer';
import {
	buildPackageEntryUrl,
	normalizeRegistryUrl,
	packageSpecToEsmPath,
	resolveImport,
	rewriteImports
} from './mcp-package-runtime';

describe('browser MCP package runtime', () => {
	beforeAll(async () => {
		await init;
	});

	it('builds pinned browser ESM entry URLs', () => {
		expect(buildPackageEntryUrl('https://esm.sh/path', '@example/mcp-server')).toBe(
			'https://esm.sh/@example/mcp-server?bundle=&target=es2022&platform=browser'
		);
		expect(packageSpecToEsmPath('github:example/mcp-server')).toBe('gh/example/mcp-server');
	});

	it('only permits insecure registries on loopback', () => {
		expect(normalizeRegistryUrl('http://127.0.0.1:8787/path')).toBe('http://127.0.0.1:8787');
		expect(() => normalizeRegistryUrl('http://example.test')).toThrow(
			'HTTP package registries are only allowed on localhost.'
		);
	});

	it('resolves and rewrites cached module imports', () => {
		const importer = 'https://esm.sh/@example/mcp-server?bundle=';
		expect(resolveImport('/node/process.mjs', importer, 'https://esm.sh')).toBe(
			'https://esm.sh/node/process.mjs'
		);
		expect(resolveImport('node:fs', importer, 'https://esm.sh')).toBeNull();
		const rewritten = rewriteImports(
			"import process from '/node/process.mjs';",
			new Map([['/node/process.mjs', 'blob:cached-process']])
		);
		expect(rewritten).toContain("from 'blob:cached-process'");
	});
});
