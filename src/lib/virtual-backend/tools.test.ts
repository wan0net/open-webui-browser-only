import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, runToolCompletion } from './tools';

const server = (url: string, name = 'lookup') => ({
	url,
	specs: [{ name, description: 'Look something up', parameters: { type: 'object' } }]
});

describe('browser tool completion', () => {
	it('uses unique provider names for duplicate tool names', () => {
		const registry = createToolRegistry([server('https://one.test'), server('https://two.test')]);
		expect(registry.tools.map((tool) => tool.function.name)).toEqual(['lookup', 'server_1_lookup']);
		expect(registry.find('server_1_lookup')?.server.url).toBe('https://two.test');
	});

	it('executes an approved tool and continues the model turn', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'call-1',
									type: 'function',
									function: { name: 'lookup', arguments: '{"query":"alpha"}' }
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { role: 'assistant', content: 'Found it.' } }]
			});
		const execute = vi.fn().mockResolvedValue({ value: 42 });

		const result = await runToolCompletion({
			formData: { model: 'test', messages: [{ role: 'user', content: 'Find alpha' }] },
			servers: [server('https://tools.test')],
			complete,
			execute,
			approve: async () => true
		});

		expect(result.choices[0].message.content).toBe('Found it.');
		expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'lookup' }), {
			query: 'alpha'
		});
		expect(complete.mock.calls[1][0].messages.at(-1)).toEqual({
			role: 'tool',
			tool_call_id: 'call-1',
			content: '{"value":42}'
		});
	});

	it('returns a declined result without executing the tool', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							tool_calls: [
								{
									id: 'call-1',
									function: { name: 'lookup', arguments: '{}' }
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { role: 'assistant', content: 'Declined.' } }]
			});
		const execute = vi.fn();

		await runToolCompletion({
			formData: { messages: [] },
			servers: [server('https://tools.test')],
			complete,
			execute,
			approve: async () => false
		});

		expect(execute).not.toHaveBeenCalled();
		expect(complete.mock.calls[1][0].messages.at(-1).content).toContain('declined');
	});
});
