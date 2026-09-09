import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const host = '127.0.0.1';
const port = 4173;
const basePath = (process.env.BROWSER_ONLY_BASE_PATH ?? '').replace(/\/$/, '');
const buildRoot = resolve('build');
const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.wasm': 'application/wasm',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

const server = createServer((request, response) => {
	const pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
	if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
		response.writeHead(404).end('Not found');
		return;
	}

	const relativePath = pathname.slice(basePath.length).replace(/^\/+/, '') || 'index.html';
	let filePath = resolve(buildRoot, relativePath);
	if (filePath !== buildRoot && !filePath.startsWith(`${buildRoot}${sep}`)) {
		response.writeHead(400).end('Invalid path');
		return;
	}

	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		if (extname(relativePath)) {
			response.writeHead(404).end('Not found');
			return;
		}
		filePath = resolve(buildRoot, 'index.html');
	}

	response.writeHead(200, {
		'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
	});
	createReadStream(filePath).pipe(response);
});

await new Promise((resolve, reject) => {
	server.once('error', reject);
	server.listen(port, host, resolve);
});

try {
	const smoke = spawn(
		'npx',
		['cypress', 'run', '--browser', 'electron', '--spec', 'cypress/e2e/browser-only.cy.ts'],
		{
			stdio: 'inherit',
			env: {
				...process.env,
				CYPRESS_BASE_URL: `http://${host}:${port}`,
				CYPRESS_BASE_PATH: basePath
			}
		}
	);
	const exitCode = await new Promise((resolve) => smoke.once('exit', resolve));
	if (exitCode !== 0) process.exitCode = exitCode ?? 1;
} finally {
	await new Promise((resolve) => server.close(resolve));
}
