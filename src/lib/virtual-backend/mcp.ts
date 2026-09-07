const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_REQUEST_TIMEOUT = 30_000;

type McpConnection = {
	url: string;
	token?: string | null;
	headers?: Record<string, string>;
	sessionId?: string | null;
};

const parseSseResponse = (text: string) => {
	for (const block of text.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
			.join('\n');
		if (!data) continue;
		try {
			return JSON.parse(data);
		} catch {
			// Ignore non-JSON events and continue to the next SSE block.
		}
	}
	return null;
};

const mcpRequest = async (
	connection: McpConnection,
	method: string,
	params?: Record<string, any>,
	notification = false
) => {
	const id = notification ? undefined : crypto.randomUUID();
	const response = await fetch(connection.url, {
		method: 'POST',
		headers: {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
			'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
			...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
			...(connection.sessionId ? { 'Mcp-Session-Id': connection.sessionId } : {}),
			...(connection.headers ?? {})
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			...(id ? { id } : {}),
			method,
			...(params ? { params } : {})
		}),
		signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT)
	});

	if (!response.ok) {
		throw new Error(`MCP request failed (${response.status}): ${await response.text()}`);
	}

	connection.sessionId = response.headers.get('Mcp-Session-Id') ?? connection.sessionId;
	if (notification || response.status === 202) return null;

	const contentType = response.headers.get('Content-Type') ?? '';
	const result = contentType.includes('text/event-stream')
		? parseSseResponse(await response.text())
		: await response.json();

	if (result?.error) {
		throw new Error(result.error.message ?? 'MCP server returned an error');
	}
	return result?.result ?? result;
};

const connect = async (config: any): Promise<McpConnection> => {
	const authType = config?.auth_type ?? 'bearer';
	const connection: McpConnection = {
		url: config.url,
		token: authType === 'bearer' ? config.key : authType === 'session' ? localStorage.token : null,
		headers: config.headers ?? {}
	};

	await mcpRequest(connection, 'initialize', {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: 'open-webui-browser-only', version: '0.1.0' }
	});
	await mcpRequest(connection, 'notifications/initialized', undefined, true);
	return connection;
};

export const discoverMcpServer = async (config: any) => {
	const connection = await connect(config);
	const tools: any[] = [];
	let cursor: string | undefined;
	do {
		const page = await mcpRequest(connection, 'tools/list', cursor ? { cursor } : {});
		tools.push(...(page?.tools ?? []));
		cursor = page?.nextCursor;
	} while (cursor);

	return {
		type: 'mcp',
		url: config.url,
		info: {
			title: config?.info?.name || config?.info?.id || new URL(config.url).host,
			description: config?.info?.description ?? 'Remote MCP server'
		},
		specs: tools.map((tool) => ({
			name: tool.name,
			description: tool.description ?? 'No description available.',
			parameters: tool.inputSchema ?? { type: 'object', properties: {} }
		})),
		mcp: {
			sessionId: connection.sessionId,
			token: connection.token,
			headers: connection.headers
		}
	};
};

export const executeMcpTool = async (
	serverData: any,
	name: string,
	params: Record<string, any>
) => {
	const connection: McpConnection = {
		url: serverData.url,
		token: serverData?.mcp?.token,
		headers: serverData?.mcp?.headers,
		sessionId: serverData?.mcp?.sessionId
	};
	const result = await mcpRequest(connection, 'tools/call', { name, arguments: params ?? {} });
	serverData.mcp.sessionId = connection.sessionId;
	return result;
};
