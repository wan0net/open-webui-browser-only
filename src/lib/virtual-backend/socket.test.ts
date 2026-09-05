import { afterEach, describe, expect, it, vi } from 'vitest';
import { virtualSocket } from './socket';

describe('virtual socket completion relay', () => {
	afterEach(() => {
		vi.useRealTimers();
		virtualSocket.off('events');
	});

	it('turns provider SSE into Open WebUI completion events', async () => {
		vi.useFakeTimers();
		const events: any[] = [];
		virtualSocket.on('events', (event) => events.push(event));
		virtualSocket.startCompletion('test-channel', {
			chatId: 'chat-1',
			messageId: 'message-1'
		});

		virtualSocket.emit('test-channel', 'data: {"choices":[{"delta":{"content":"hello"}}]}');
		await Promise.resolve();

		expect(events[0]).toMatchObject({
			chat_id: 'chat-1',
			message_id: 'message-1',
			data: {
				type: 'chat:completion',
				data: { choices: [{ delta: { content: 'hello' } }] }
			}
		});

		virtualSocket.emit('test-channel', 'data: [DONE]');
		await Promise.resolve();
		expect(events[1].data).toEqual({ type: 'chat:completion', data: { done: true } });

		await vi.runAllTimersAsync();
		expect(events[2].data).toEqual({ type: 'chat:active', data: { active: false } });
	});
});
