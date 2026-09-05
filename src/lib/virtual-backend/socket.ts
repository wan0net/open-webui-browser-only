type Listener = (...args: any[]) => void;

type CompletionContext = {
	chatId: string;
	messageId: string;
	onPayload?: (payload: any) => void | Promise<void>;
};

const parseStreamPayload = (value: unknown) => {
	if (typeof value !== 'string') return value;

	const line = value.trim();
	if (!line || line.startsWith(':')) return null;
	const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
	if (payload === '[DONE]') return { done: true };

	try {
		return JSON.parse(payload);
	} catch {
		return null;
	}
};

class VirtualSocket {
	id = `browser-${crypto.randomUUID()}`;
	connected = true;

	private listeners = new Map<string, Set<Listener>>();
	private completions = new Map<string, CompletionContext>();

	on(event: string, listener: Listener) {
		const listeners = this.listeners.get(event) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return this;
	}

	off(event: string, listener?: Listener) {
		if (listener) this.listeners.get(event)?.delete(listener);
		else this.listeners.delete(event);
		return this;
	}

	emit(event: string, value?: unknown, callback?: Listener) {
		const completion = this.completions.get(event);
		if (completion) {
			const payload = parseStreamPayload(value);
			if (payload) {
				void completion.onPayload?.(payload);
				this.dispatch('events', {
					chat_id: completion.chatId,
					message_id: completion.messageId,
					internal: true,
					data: { type: 'chat:completion', data: payload }
				});
				if ((payload as any)?.done) {
					this.completions.delete(event);
					setTimeout(
						() =>
							this.dispatch('events', {
								chat_id: completion.chatId,
								message_id: completion.messageId,
								internal: true,
								data: { type: 'chat:active', data: { active: false } }
							}),
						0
					);
				}
			}
			return this;
		}

		this.dispatch(event, value, callback);
		return this;
	}

	dispatch(event: string, ...args: any[]) {
		for (const listener of this.listeners.get(event) ?? []) {
			queueMicrotask(() => listener(...args));
		}
	}

	startCompletion(channel: string, context: CompletionContext) {
		this.completions.set(channel, context);
	}

	connect() {
		this.connected = true;
		this.dispatch('connect');
		return this;
	}

	disconnect() {
		this.connected = false;
		this.dispatch('disconnect', 'browser shutdown');
		return this;
	}
}

export const virtualSocket = new VirtualSocket();
