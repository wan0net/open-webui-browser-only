const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_RESULT_LENGTH = 100_000;

type ToolRegistration = {
	providerName: string;
	name: string;
	server: any;
};

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export const createToolRegistry = (servers: any[]) => {
	const registrations: ToolRegistration[] = [];
	const usedNames = new Set<string>();

	for (const [serverIndex, server] of (servers ?? []).entries()) {
		for (const spec of server?.specs ?? []) {
			let providerName = safeName(spec.name);
			if (!providerName || usedNames.has(providerName)) {
				providerName = safeName(`server_${serverIndex}_${spec.name}`);
			}
			let suffix = 2;
			const baseName = providerName;
			while (usedNames.has(providerName)) {
				providerName = safeName(`${baseName}_${suffix++}`);
			}
			usedNames.add(providerName);
			registrations.push({ providerName, name: spec.name, server });
		}
	}

	return {
		tools: registrations.map((registration) => {
			const spec = registration.server.specs.find((item) => item.name === registration.name);
			return {
				type: 'function',
				function: {
					name: registration.providerName,
					description: spec?.description ?? 'No description available.',
					parameters: spec?.parameters ?? { type: 'object', properties: {} }
				}
			};
		}),
		find: (providerName: string) =>
			registrations.find((registration) => registration.providerName === providerName)
	};
};

const stringifyResult = (result: unknown) => {
	const value = typeof result === 'string' ? result : JSON.stringify(result);
	return value.length > MAX_TOOL_RESULT_LENGTH
		? `${value.slice(0, MAX_TOOL_RESULT_LENGTH)}\n[Tool result truncated]`
		: value;
};

export const runToolCompletion = async ({
	formData,
	servers,
	complete,
	execute,
	approve
}: {
	formData: Record<string, any>;
	servers: any[];
	complete: (payload: Record<string, any>) => Promise<any>;
	execute: (registration: ToolRegistration, params: Record<string, any>) => Promise<any>;
	approve: (registration: ToolRegistration, params: Record<string, any>) => Promise<boolean>;
}) => {
	const registry = createToolRegistry(servers);
	if (registry.tools.length === 0) return complete(formData);

	const messages = [...(formData.messages ?? [])];
	for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
		const response = await complete({
			...formData,
			stream: false,
			messages,
			tools: registry.tools,
			tool_choice: formData.tool_choice ?? 'auto'
		});
		const message = response?.choices?.[0]?.message;
		const toolCalls = message?.tool_calls ?? [];
		if (toolCalls.length === 0) return response;

		messages.push({ ...message, role: 'assistant' });
		for (const toolCall of toolCalls) {
			const registration = registry.find(toolCall?.function?.name);
			let params: Record<string, any> = {};
			try {
				params = JSON.parse(toolCall?.function?.arguments || '{}');
			} catch {
				params = {};
			}

			let result: unknown;
			if (!registration) {
				result = { error: `Unknown browser tool: ${toolCall?.function?.name}` };
			} else if (!(await approve(registration, params))) {
				result = { error: 'The user declined this tool call.' };
			} else {
				try {
					result = await execute(registration, params);
				} catch (error: any) {
					result = { error: error?.message ?? String(error) };
				}
			}

			messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: stringifyResult(result)
			});
		}
	}

	throw new Error(`Stopped after ${MAX_TOOL_ROUNDS} browser tool rounds`);
};
