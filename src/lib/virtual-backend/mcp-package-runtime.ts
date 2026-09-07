import { init, parse } from 'es-module-lexer';
import { getMcpPackage, putMcpPackage, type LocalMcpPackage } from './db';

const DEFAULT_REGISTRY = 'https://esm.sh';
const DEFAULT_MAX_MODULES = 80;
const REQUEST_TIMEOUT = 30_000;
const PROTOCOL_VERSION = '2025-03-26';

type PackageConfig = {
	type: 'mcp_package';
	url: string;
	package_name: string;
	registry_url?: string;
	args?: string[];
	env?: Record<string, string>;
	info?: { id?: string; name?: string; description?: string };
};

type ModuleRecord = { url: string; code: string };
type PendingRequest = {
	resolve: (value: any) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type RuntimeSession = {
	worker: Worker;
	request: (method: string, params?: Record<string, any>) => Promise<any>;
	notify: (method: string, params?: Record<string, any>) => void;
	dispose: () => void;
};

const sessions = new Map<string, RuntimeSession>();

export const packageSpecToEsmPath = (packageName: string) => {
	const value = packageName.trim();
	const github = value.match(/^(?:github:|gh:)([^/\s]+\/[^#?\s]+)(.*)$/i);
	return github ? `gh/${github[1]}${github[2] ?? ''}` : value;
};

export const normalizeRegistryUrl = (value = DEFAULT_REGISTRY) => {
	const url = new URL(value);
	if (!['https:', 'http:'].includes(url.protocol)) {
		throw new Error('The package registry must use HTTP or HTTPS.');
	}
	if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
		throw new Error('HTTP package registries are only allowed on localhost.');
	}
	return `${url.protocol}//${url.host}`;
};

export const buildPackageEntryUrl = (registryUrl: string, packageName: string) => {
	const base = normalizeRegistryUrl(registryUrl);
	const url = new URL(packageSpecToEsmPath(packageName), `${base}/`);
	url.searchParams.set('bundle', '');
	url.searchParams.set('target', 'es2022');
	url.searchParams.set('platform', 'browser');
	return url.toString();
};

export const resolveImport = (specifier: string, importer: string, registryUrl: string) => {
	if (!specifier || /^(node:|data:|blob:)/i.test(specifier)) return null;
	if (/^https?:\/\//i.test(specifier)) return new URL(specifier).toString();
	const importerUrl = new URL(importer);
	if (specifier.startsWith('/')) return new URL(specifier, importerUrl.origin).toString();
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		return new URL(specifier, importerUrl).toString();
	}
	return new URL(specifier, `${normalizeRegistryUrl(registryUrl)}/`).toString();
};

export const rewriteImports = (code: string, replacements: Map<string, string>) => {
	const [imports] = parse(code);
	let output = code;
	for (const item of [...imports].reverse()) {
		if (item.n && replacements.has(item.n)) {
			output = `${output.slice(0, item.s)}${replacements.get(item.n)}${output.slice(item.e)}`;
		}
	}
	return output;
};

const sha256 = async (value: string) => {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const packageId = async (packageName: string, entryUrl: string) =>
	(await sha256(`${packageName}\n${entryUrl}`)).slice(0, 24);

const defaultBinPackageName = (packageName: string) => {
	const path = packageName.split('?')[0];
	const segments = path.split('/').filter(Boolean);
	const hasSubpath = packageName.startsWith('@') ? segments.length > 2 : segments.length > 1;
	return hasSubpath ? null : `${packageName.replace(/\/$/, '')}/dist/index.js`;
};

const fetchPackage = async (config: PackageConfig): Promise<LocalMcpPackage> => {
	await init;
	const registryUrl = normalizeRegistryUrl(config.registry_url);
	let entryUrl = buildPackageEntryUrl(registryUrl, config.package_name);
	let id = await packageId(config.package_name, entryUrl);
	let cached = await getMcpPackage(id);
	if (cached) return cached;
	let triedDefaultBin = false;

	const queue = [entryUrl];
	const modules = new Map<string, ModuleRecord>();
	while (queue.length > 0) {
		if (modules.size >= DEFAULT_MAX_MODULES) {
			throw new Error(`Browser MCP package exceeded ${DEFAULT_MAX_MODULES} modules.`);
		}
		const url = queue.shift()!;
		if (modules.has(url)) continue;
		if (new URL(url).origin !== new URL(registryUrl).origin) {
			throw new Error(`Browser MCP package tried to load outside its registry: ${url}`);
		}
		const response = await fetch(url);
		if (!response.ok && url === entryUrl && response.status === 404 && !triedDefaultBin) {
			const fallbackPackage = defaultBinPackageName(config.package_name);
			if (fallbackPackage) {
				triedDefaultBin = true;
				entryUrl = buildPackageEntryUrl(registryUrl, fallbackPackage);
				id = await packageId(config.package_name, entryUrl);
				cached = await getMcpPackage(id);
				if (cached) return cached;
				queue.unshift(entryUrl);
				continue;
			}
		}
		if (!response.ok) throw new Error(`Failed to download ${url} (${response.status}).`);
		const code = await response.text();
		modules.set(url, { url, code });
		const [imports] = parse(code);
		for (const item of imports) {
			if (!item.n) continue;
			const resolved = resolveImport(item.n, url, registryUrl);
			if (resolved && !modules.has(resolved)) queue.push(resolved);
		}
	}

	const moduleObject = Object.fromEntries([...modules].map(([url, record]) => [url, record.code]));
	const hashes: Record<string, string> = {};
	for (const [url, code] of Object.entries(moduleObject)) hashes[url] = await sha256(code);
	const installed: LocalMcpPackage = {
		id,
		package_name: config.package_name,
		entry_url: entryUrl,
		registry_url: registryUrl,
		module_urls: [...modules.keys()].sort(),
		module_hashes: hashes,
		modules: moduleObject,
		installed_at: Date.now()
	};
	await putMcpPackage(installed);
	return installed;
};

const createWorker = async (installed: LocalMcpPackage, config: PackageConfig) => {
	await init;
	for (const [url, code] of Object.entries(installed.modules)) {
		if ((await sha256(code)) !== installed.module_hashes[url]) {
			throw new Error(`Cached browser MCP package failed its integrity check: ${url}`);
		}
	}

	const blobUrls = new Map<string, string>();
	const visiting = new Set<string>();
	const buildBlob = (url: string): string => {
		const existing = blobUrls.get(url);
		if (existing) return existing;
		if (visiting.has(url)) throw new Error(`Circular package import is not supported: ${url}`);
		const code = installed.modules[url];
		if (code === undefined) throw new Error(`Cached package module is missing: ${url}`);
		visiting.add(url);
		const replacements = new Map<string, string>();
		const [imports] = parse(code);
		for (const item of imports) {
			if (!item.n) continue;
			const resolved = resolveImport(item.n, url, installed.registry_url);
			if (resolved) replacements.set(item.n, buildBlob(resolved));
		}
		visiting.delete(url);
		const blobUrl = URL.createObjectURL(
			new Blob([rewriteImports(code, replacements)], { type: 'text/javascript' })
		);
		blobUrls.set(url, blobUrl);
		return blobUrl;
	};

	const entryBlob = buildBlob(installed.entry_url);
	const bootstrap = createBootstrap(entryBlob, config);
	const bootstrapUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
	const worker = new Worker(bootstrapUrl, { type: 'module', name: `browser-mcp-${installed.id}` });
	URL.revokeObjectURL(bootstrapUrl);
	return {
		worker,
		dispose: () => {
			worker.terminate();
			for (const url of blobUrls.values()) URL.revokeObjectURL(url);
		}
	};
};

const createBootstrap = (entryUrl: string, config: PackageConfig) => `
const deny = (name) => () => { throw new Error(name + ' is disabled in the browser MCP runtime.'); };
const stdinHandlers = new Set();
self.fetch = deny('Network access');
self.XMLHttpRequest = deny('XMLHttpRequest');
self.WebSocket = deny('WebSocket');
self.EventSource = deny('EventSource');
self.importScripts = deny('importScripts');
self.Worker = deny('Child workers');
self.SharedWorker = deny('Shared workers');
self.process = {
  env: Object.freeze(${JSON.stringify(config.env ?? {})}),
  argv: Object.freeze(${JSON.stringify(['browser-mcp', config.package_name, ...(config.args ?? [])])}),
  platform: 'browser',
  versions: Object.freeze({ node: '20.0.0-browser-shim' }),
  cwd: () => '/',
  stdout: { write: (chunk) => { self.postMessage({ type: 'stdout', chunk: String(chunk) }); return true; } },
  stderr: { write: (chunk) => { self.postMessage({ type: 'stderr', chunk: String(chunk) }); return true; } },
  stdin: {
    on: (event, handler) => { if (event === 'data' && typeof handler === 'function') stdinHandlers.add(handler); return self.process.stdin; },
    off: (_event, handler) => { stdinHandlers.delete(handler); return self.process.stdin; },
    read: () => null,
    resume: () => self.process.stdin,
    setEncoding: () => self.process.stdin,
  },
  nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
};
self.addEventListener('message', (event) => {
  if (event.data?.type === 'stdin') {
    const chunk = String(event.data.chunk ?? '');
    for (const handler of stdinHandlers) handler(chunk);
  }
});
try {
  await import(${JSON.stringify(entryUrl)});
  self.postMessage({ type: 'ready' });
} catch (error) {
  self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
`;

const startSession = async (config: PackageConfig): Promise<RuntimeSession> => {
	const installed = await fetchPackage(config);
	const runtime = await createWorker(installed, config);
	let nextId = 1;
	let buffer = '';
	let disposed = false;
	const pending = new Map<number, PendingRequest>();

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const item of pending.values()) {
			clearTimeout(item.timer);
			item.reject(new Error('Browser MCP runtime stopped.'));
		}
		pending.clear();
		runtime.dispose();
	};

	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('Browser MCP package did not start.')),
				10_000
			);
			runtime.worker.addEventListener('message', (event) => {
				if (event.data?.type === 'ready') {
					clearTimeout(timer);
					resolve();
				} else if (event.data?.type === 'error') {
					clearTimeout(timer);
					reject(new Error(event.data.message || 'Browser MCP package failed to start.'));
				}
			});
			runtime.worker.addEventListener('error', (event) => {
				clearTimeout(timer);
				reject(new Error(event.message));
			});
		});
	} catch (error) {
		runtime.dispose();
		throw error;
	}
	runtime.worker.addEventListener('error', (event) => {
		for (const item of pending.values()) {
			clearTimeout(item.timer);
			item.reject(new Error(event.message || 'Browser MCP package stopped unexpectedly.'));
		}
		pending.clear();
	});

	runtime.worker.addEventListener('message', (event) => {
		if (event.data?.type !== 'stdout') return;
		buffer += String(event.data.chunk ?? '');
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			try {
				const message = JSON.parse(line);
				const item = pending.get(message.id);
				if (!item) continue;
				pending.delete(message.id);
				clearTimeout(item.timer);
				if (message.error) item.reject(new Error(message.error.message ?? 'MCP request failed.'));
				else item.resolve(message.result);
			} catch {
				// Packages may write diagnostics to stdout. Only JSON-RPC lines are consumed.
			}
		}
	});

	const send = (message: Record<string, any>) =>
		runtime.worker.postMessage({ type: 'stdin', chunk: `${JSON.stringify(message)}\n` });
	const request = (method: string, params: Record<string, any> = {}) =>
		new Promise<any>((resolve, reject) => {
			const id = nextId++;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Browser MCP ${method} timed out.`));
			}, REQUEST_TIMEOUT);
			pending.set(id, { resolve, reject, timer });
			send({ jsonrpc: '2.0', id, method, params });
		});
	const notify = (method: string, params: Record<string, any> = {}) =>
		send({ jsonrpc: '2.0', method, params });

	return { worker: runtime.worker, request, notify, dispose };
};

const connect = async (config: PackageConfig) => {
	const old = sessions.get(config.url);
	old?.dispose();
	const session = await startSession(config);
	try {
		await session.request('initialize', {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: 'open-webui-browser-only', version: '0.2.0' }
		});
		session.notify('notifications/initialized');
		sessions.set(config.url, session);
		return session;
	} catch (error) {
		session.dispose();
		throw error;
	}
};

export const discoverMcpPackageServer = async (config: PackageConfig) => {
	if (!config.package_name?.trim()) throw new Error('Enter an MCP package name.');
	const session = await connect(config);
	const tools: any[] = [];
	let cursor: string | undefined;
	do {
		const page = await session.request('tools/list', cursor ? { cursor } : {});
		tools.push(...(page?.tools ?? []));
		cursor = page?.nextCursor;
	} while (cursor);
	return {
		type: 'mcp_package',
		url: config.url,
		mcp_package: config,
		info: {
			title: config.info?.name || config.package_name,
			description: config.info?.description || `Browser MCP package ${config.package_name}`
		},
		specs: tools.map((tool) => ({
			name: tool.name,
			description: tool.description ?? 'No description available.',
			parameters: tool.inputSchema ?? { type: 'object', properties: {} }
		}))
	};
};

export const executeMcpPackageTool = async (
	serverData: any,
	name: string,
	params: Record<string, any>
) => {
	let session = sessions.get(serverData.url);
	if (!session && serverData.mcp_package) session = await connect(serverData.mcp_package);
	if (!session) throw new Error('Browser MCP package session is not running. Reconnect it first.');
	return session.request('tools/call', { name, arguments: params ?? {} });
};

export const stopMcpPackageServer = (url: string) => {
	sessions.get(url)?.dispose();
	sessions.delete(url);
};

const isLoopback = (hostname: string) =>
	hostname === 'localhost' ||
	hostname === '::1' ||
	hostname === '127.0.0.1' ||
	hostname.startsWith('127.');
