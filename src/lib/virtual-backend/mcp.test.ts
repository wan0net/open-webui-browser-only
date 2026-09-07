import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverMcpServer, executeMcpTool } from './mcp';

const response = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

describe('browser MCP client', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('initializes a Streamable HTTP session and discovers tools', async () => {
		vi.stubGlobal('localStorage', { token: 'local' });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response(
					{ jsonrpc: '2.0', id: 'init', result: { protocolVersion: '2025-03-26' } },
					{ 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' }
				)
			)
			.mockResolvedValueOnce(response('', {}, 202))
			.mockResolvedValueOnce(
				response(
					{ jsonrpc: '2.0', id: 'list', result: { tools: [{ name: 'echo', inputSchema: {} }] } },
					{ 'Content-Type': 'application/json' }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const discovered = await discoverMcpServer({
			type: 'mcp',
			url: 'https://mcp.test/',
			auth_type: 'bearer',
			key: 'secret',
			config: { enable: true },
			info: { name: 'Test MCP' }
		});

		expect(discovered.specs[0].name).toBe('echo');
		expect(discovered.mcp.sessionId).toBe('session-1');
		expect(fetchMock.mock.calls[1][1].headers['Mcp-Session-Id']).toBe('session-1');
		expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer secret');
	});

	it('accepts SSE responses when calling a tool', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					response(
						'event: message\ndata: {"jsonrpc":"2.0","id":"call","result":{"content":[{"type":"text","text":"hello"}]}}\n\n',
						{ 'Content-Type': 'text/event-stream' }
					)
				)
		);

		const result = await executeMcpTool(
			{ url: 'https://mcp.test/', mcp: { sessionId: 'session-1' } },
			'echo',
			{ text: 'hello' }
		);
		expect(result.content[0].text).toBe('hello');
	});
});
