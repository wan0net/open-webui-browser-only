import {
	clearChats,
	deleteChat,
	deleteFolder,
	getChat,
	getFolder,
	getSettings,
	listChats,
	listFolders,
	putChat,
	putFolder,
	putSettings,
	type LocalChat,
	type LocalFolder
} from './db';
import { virtualSocket } from './socket';
import { base } from '$app/paths';

const VERSION = '0.11.3-browser';
const PAGE_SIZE = 60;

const permissions = {
	workspace: { models: false, knowledge: false, prompts: false, tools: false },
	sharing: {
		public_models: false,
		public_knowledge: false,
		public_prompts: false,
		public_tools: false
	},
	chat: {
		controls: true,
		file_upload: false,
		delete: true,
		edit: true,
		share: false,
		temporary: true,
		import: true,
		export: true
	},
	features: {
		direct_tool_servers: true,
		web_search: false,
		image_generation: false,
		code_interpreter: false,
		memories: false
	}
};

const localUser = {
	id: 'local',
	name: 'Local User',
	email: 'local@browser.invalid',
	role: 'user',
	profile_image_url: `${base}/user.png`,
	last_active_at: Math.floor(Date.now() / 1000),
	created_at: Math.floor(Date.now() / 1000),
	api_key: null,
	settings: {},
	info: {},
	oauth_sub: null,
	auth_type: 'local',
	permissions
};

const config = {
	status: true,
	name: 'Open WebUI',
	version: VERSION,
	default_locale: 'en-US',
	oauth: { providers: {}, auto_redirect: false },
	features: {
		auth: true,
		auth_trusted_header: false,
		enable_signup: false,
		enable_login_form: false,
		enable_websocket: false,
		enable_api_keys: false,
		enable_password_change_form: false,
		enable_version_update_check: false,
		enable_pyodide_file_persistence: false,
		enable_public_active_users_count: false,
		enable_easter_eggs: false,
		enable_direct_connections: true,
		enable_plugins: false,
		enable_folders: true,
		folder_max_file_count: 0,
		enable_channels: false,
		enable_calendar: false,
		enable_automations: false,
		enable_notes: false,
		enable_context_compaction: false,
		enable_tool_permissions: true,
		enable_web_search: false,
		enable_code_execution: false,
		enable_code_interpreter: false,
		enable_image_generation: false,
		enable_autocomplete_generation: false,
		enable_community_sharing: false,
		enable_message_rating: false,
		enable_user_webhooks: false,
		enable_user_status: false,
		enable_admin_export: false,
		enable_admin_chat_access: false,
		enable_admin_analytics: false,
		enable_google_drive_integration: false,
		enable_onedrive_integration: false,
		enable_memories: false
	},
	default_models: '',
	default_pinned_models: '',
	default_prompt_suggestions: [],
	code: { engine: '', interpreter_engine: '' },
	audio: { tts: { engine: '', voice: '', split_on: 'punctuation' }, stt: { engine: '' } },
	file: { max_size: 0, max_count: 0, image_compression: { width: null, height: null } },
	permissions,
	google_drive: { client_id: '', api_key: '' },
	onedrive: {},
	ui: { default_interface_settings: {}, response_watermark: null, iframe_csp: null }
};

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

const ndjson = (items: unknown[]) =>
	new Response(items.map((item) => JSON.stringify(item)).join('\n'), {
		headers: { 'Content-Type': 'application/x-ndjson' }
	});

const body = async (request: Request) => {
	try {
		return await request.json();
	} catch {
		return {};
	}
};

const browserPath = (url: URL) =>
	base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length) : url.pathname;

const chatSummary = (chat: LocalChat) => ({
	id: chat.id,
	title: chat.title,
	updated_at: chat.updated_at,
	created_at: chat.created_at,
	pinned: chat.pinned,
	archived: chat.archived,
	folder_id: chat.folder_id,
	meta: chat.meta,
	last_read_at: chat.last_read_at ?? chat.updated_at
});

const createChat = async (payload: any) => {
	const now = Math.floor(Date.now() / 1000);
	const chatData = payload.chat ?? {};
	const id = chatData.id || crypto.randomUUID();
	const record: LocalChat = {
		id,
		user_id: localUser.id,
		title: chatData.title ?? 'New Chat',
		chat: { ...chatData, id },
		created_at: now,
		updated_at: now,
		share_id: null,
		archived: false,
		pinned: false,
		folder_id: payload.folder_id ?? null,
		meta: {},
		last_read_at: now
	};
	await putChat(record);
	return record;
};

const updateChat = async (id: string, payload: any) => {
	const existing = await getChat(id);
	if (!existing) return null;
	const next = {
		...existing,
		chat: { ...existing.chat, ...(payload.chat ?? {}) },
		variables: payload.variables ?? existing.variables,
		title: payload.chat?.title ?? existing.title,
		updated_at: Math.floor(Date.now() / 1000)
	};
	await putChat(next);
	return next;
};

const allTags = (chats: LocalChat[]) => {
	const names = new Set<string>();
	for (const chat of chats) for (const tag of chat.chat?.tags ?? []) names.add(tag.name ?? tag);
	return [...names].map((name) => ({ id: name, name }));
};

const messagesForProvider = (history: any, endId: string) => {
	const messages = [];
	let current = history?.messages?.[endId];
	while (current) {
		messages.unshift({ role: current.role, content: current.content ?? '' });
		current = current.parentId ? history.messages[current.parentId] : null;
	}
	return messages;
};

const prepareCompletionChat = async (payload: any) => {
	const now = Math.floor(Date.now() / 1000);
	let chat = payload.chat_id ? await getChat(payload.chat_id) : null;
	const chatId = chat?.id ?? crypto.randomUUID();
	const history = structuredClone(chat?.chat?.history ?? { messages: {}, currentId: null });
	const userMessage = structuredClone(payload.user_message);
	const generatedTitle =
		String(userMessage?.content ?? 'New Chat')
			.trim()
			.slice(0, 60) || 'New Chat';
	const responseMessage = {
		id: payload.id,
		parentId: userMessage?.id ?? payload.parent_id ?? null,
		childrenIds: [],
		role: 'assistant',
		content: '',
		done: false,
		model: payload.model,
		modelName: payload.model,
		timestamp: now
	};

	if (userMessage?.id) {
		const parent = userMessage.parentId ? history.messages[userMessage.parentId] : null;
		if (parent && !parent.childrenIds?.includes(userMessage.id)) {
			parent.childrenIds = [...(parent.childrenIds ?? []), userMessage.id];
		}
		userMessage.childrenIds = [
			...new Set([...(userMessage.childrenIds ?? []), responseMessage.id])
		];
		history.messages[userMessage.id] = userMessage;
	}
	history.messages[responseMessage.id] = responseMessage;
	history.currentId = responseMessage.id;

	const chatData = {
		...(chat?.chat ?? {}),
		id: chatId,
		title: chat?.title && chat.title !== 'New Chat' ? chat.title : generatedTitle,
		models: chat?.chat?.models ?? [payload.model],
		history,
		messages: messagesForProvider(history, responseMessage.id),
		timestamp: chat?.chat?.timestamp ?? Date.now(),
		tags: chat?.chat?.tags ?? []
	};

	chat = {
		id: chatId,
		user_id: localUser.id,
		title: chatData.title,
		chat: chatData,
		created_at: chat?.created_at ?? now,
		updated_at: now,
		share_id: null,
		archived: chat?.archived ?? false,
		pinned: chat?.pinned ?? false,
		folder_id: chat?.folder_id ?? payload.folder_id ?? null,
		meta: chat?.meta ?? {},
		last_read_at: now
	};
	await putChat(chat);
	return chat;
};

const persistCompletionPayload = async (chatId: string, messageId: string, payload: any) => {
	const chat = await getChat(chatId);
	const message = chat?.chat?.history?.messages?.[messageId];
	if (!chat || !message) return;

	if (payload?.choices?.[0]?.delta?.content) message.content += payload.choices[0].delta.content;
	if (payload?.choices?.[0]?.message?.content)
		message.content += payload.choices[0].message.content;
	if (payload?.content) message.content = payload.content;
	if (payload?.error) message.error = { content: payload.error };
	if (payload?.done) message.done = true;

	chat.chat.messages = messagesForProvider(chat.chat.history, messageId);
	chat.updated_at = Math.floor(Date.now() / 1000);
	await putChat(chat);
};

const beginCompletion = async (payload: any) => {
	const taskId = crypto.randomUUID();
	const channel = `virtual:completion:${taskId}`;
	const chat = await prepareCompletionChat(payload);
	const chatId = chat.id;
	const providerMessages = messagesForProvider(chat.chat.history, payload.user_message?.id);

	virtualSocket.startCompletion(channel, {
		chatId,
		messageId: payload.id,
		onPayload: (streamPayload) => persistCompletionPayload(chatId, payload.id, streamPayload)
	});
	virtualSocket.dispatch(
		'events',
		{
			chat_id: chatId,
			message_id: payload.id,
			internal: true,
			data: {
				type: 'request:chat:completion',
				data: {
					session_id: virtualSocket.id,
					channel,
					model: payload.model_item,
					form_data: {
						model: payload.model,
						messages: payload.messages?.length ? payload.messages : providerMessages,
						stream: payload.stream ?? true,
						tool_servers: payload.tool_servers ?? [],
						...(payload.params ?? {})
					}
				}
			}
		},
		(error: any) => {
			if (error && error.status !== true) {
				virtualSocket.emit(channel, { error, done: true });
			}
		}
	);

	return { task_id: taskId, chat_id: chatId };
};

const route = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const path = browserPath(url);
	const method = request.method.toUpperCase();

	if (method === 'GET' && path === '/api/config') return json(config);
	if (method === 'GET' && path === '/api/version')
		return json({ version: VERSION, deployment_id: 'browser' });
	if (method === 'GET' && path === '/api/v1/auths/') return json(localUser);
	if (method === 'POST' && path === '/api/v1/auths/update/profile') return json(localUser);
	if (method === 'POST' && path === '/api/v1/auths/update/timezone') return json(true);

	if (method === 'GET' && path === '/api/v1/users/user/settings') return json(getSettings());
	if (method === 'POST' && path === '/api/v1/users/user/settings/update') {
		return json(putSettings(await body(request)));
	}

	if (method === 'GET' && (path === '/api/models' || path === '/api/models/base')) {
		return json({ data: [] });
	}

	if (method === 'GET' && path === '/api/v1/chats/') {
		const page = Number(url.searchParams.get('page') ?? '1');
		const chats = (await listChats()).filter((chat) => !chat.archived && !chat.pinned);
		return json(chats.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(chatSummary));
	}
	if (method === 'DELETE' && path === '/api/v1/chats/') {
		await clearChats();
		return json(true);
	}
	if (method === 'POST' && path === '/api/v1/chats/new')
		return json(await createChat(await body(request)));
	if (method === 'POST' && path === '/api/v1/chats/import') {
		const payload = await body(request);
		for (const item of payload.chats ?? []) {
			if (item?.chat && item?.id) {
				await putChat({
					...item,
					user_id: localUser.id,
					share_id: null,
					archived: item.archived ?? false,
					pinned: item.pinned ?? false,
					folder_id: item.folder_id ?? null,
					meta: item.meta ?? {}
				});
			} else {
				await createChat({ chat: item });
			}
		}
		return json(true);
	}
	if (method === 'GET' && path === '/api/v1/chats/pinned') {
		return json(
			(await listChats()).filter((chat) => chat.pinned && !chat.archived).map(chatSummary)
		);
	}
	if (method === 'GET' && path === '/api/v1/chats/archived') {
		return json((await listChats()).filter((chat) => chat.archived).map(chatSummary));
	}
	if (method === 'GET' && path === '/api/v1/chats/archived/count') {
		return json((await listChats()).filter((chat) => chat.archived).length);
	}
	if (method === 'GET' && path === '/api/v1/chats/all/tags')
		return json(allTags(await listChats()));
	if (method === 'GET' && path === '/api/v1/chats/all') return ndjson(await listChats());
	if (method === 'GET' && path === '/api/v1/chats/all/db') return json(await listChats());
	if (method === 'GET' && path === '/api/v1/chats/search') {
		const term = (url.searchParams.get('text') ?? '').toLowerCase();
		return json(
			(await listChats())
				.filter((chat) => JSON.stringify(chat.chat).toLowerCase().includes(term))
				.map(chatSummary)
		);
	}
	if (method === 'POST' && path === '/api/v1/chats/archive/all') {
		for (const chat of await listChats()) await putChat({ ...chat, archived: true });
		return json(true);
	}
	if (method === 'POST' && path === '/api/v1/chats/unarchive/all') {
		for (const chat of await listChats()) await putChat({ ...chat, archived: false });
		return json(true);
	}

	const folderListMatch = path.match(/^\/api\/v1\/chats\/folder\/([^/]+)(?:\/list)?$/);
	if (method === 'GET' && folderListMatch) {
		return json(
			(await listChats())
				.filter((chat) => chat.folder_id === folderListMatch[1] && !chat.archived)
				.map(chatSummary)
		);
	}

	const chatMatch = path.match(/^\/api\/v1\/chats\/([^/]+)(?:\/(.*))?$/);
	if (chatMatch) {
		const [, id, action = ''] = chatMatch;
		const chat = await getChat(id);
		if (!chat) return json({ detail: 'Chat not found' }, 404);

		if (method === 'GET' && !action) return json(chat);
		if (method === 'POST' && !action) return json(await updateChat(id, await body(request)));
		if (method === 'DELETE' && !action) {
			await deleteChat(id);
			return json(true);
		}
		if (method === 'GET' && action === 'pinned') return json(chat.pinned);
		if (method === 'POST' && action === 'pin') {
			const next = { ...chat, pinned: !chat.pinned };
			await putChat(next);
			return json(next);
		}
		if (method === 'POST' && action === 'archive') {
			const next = { ...chat, archived: !chat.archived };
			await putChat(next);
			return json(next);
		}
		if (method === 'POST' && action === 'folder') {
			const payload = await body(request);
			const next = { ...chat, folder_id: payload.folder_id ?? null };
			await putChat(next);
			return json(next);
		}
		if (method === 'POST' && (action === 'clone' || action === 'fork')) {
			const payload = await body(request);
			const now = Math.floor(Date.now() / 1000);
			const id = crypto.randomUUID();
			const cloned = structuredClone(chat);
			cloned.id = id;
			cloned.chat.id = id;
			cloned.title = payload.title ?? `${chat.title} (copy)`;
			cloned.chat.title = cloned.title;
			cloned.created_at = now;
			cloned.updated_at = now;
			cloned.pinned = false;
			cloned.archived = false;
			await putChat(cloned);
			return json(cloned);
		}
		if (action === 'tags') {
			const tags = [...(chat.chat?.tags ?? [])];
			if (method === 'GET') return json(tags);
			const payload = await body(request);
			const nextTags =
				method === 'POST'
					? [...tags.filter((tag) => (tag.name ?? tag) !== payload.name), { name: payload.name }]
					: tags.filter((tag) => (tag.name ?? tag) !== payload.name);
			const next = { ...chat, chat: { ...chat.chat, tags: nextTags } };
			await putChat(next);
			return json(nextTags);
		}
	}

	if (method === 'GET' && path === '/api/v1/folders/') return json(await listFolders());
	if (method === 'POST' && path === '/api/v1/folders/') {
		const payload = await body(request);
		const now = Math.floor(Date.now() / 1000);
		const folder: LocalFolder = {
			id: crypto.randomUUID(),
			user_id: localUser.id,
			name: payload.name ?? 'New Folder',
			parent_id: payload.parent_id ?? null,
			data: payload.data ?? {},
			meta: payload.meta ?? {},
			is_expanded: true,
			created_at: now,
			updated_at: now
		};
		await putFolder(folder);
		return json(folder);
	}
	const folderMatch = path.match(/^\/api\/v1\/folders\/([^/]+)(?:\/(.*))?$/);
	if (folderMatch) {
		const [, id, action = ''] = folderMatch;
		const folder = await getFolder(id);
		if (!folder) return json({ detail: 'Folder not found' }, 404);
		if (method === 'GET' && !action) return json(folder);
		if (method === 'DELETE' && !action) {
			await deleteFolder(id);
			for (const chat of await listChats()) {
				if (chat.folder_id !== id) continue;
				if (url.searchParams.get('delete_contents') === 'true') await deleteChat(chat.id);
				else await putChat({ ...chat, folder_id: null });
			}
			return json(true);
		}
		if (method === 'POST' && action.startsWith('update')) {
			const payload = await body(request);
			const next = {
				...folder,
				...payload,
				...(action === 'update/expanded' ? { is_expanded: payload.is_expanded } : {}),
				...(action === 'update/parent' ? { parent_id: payload.parent_id ?? null } : {}),
				updated_at: Math.floor(Date.now() / 1000)
			};
			await putFolder(next);
			return json(next);
		}
	}

	if (method === 'POST' && path === '/api/chat/completions') {
		const payload = await body(request);
		return json(await beginCompletion(payload));
	}

	if (
		/^\/api\/v1\/(configs\/banners|tools\/|functions\/|skills\/|channels\/|terminals\/)/.test(path)
	) {
		return json([]);
	}
	if (/^\/api\/(tasks|v1\/tasks)/.test(path)) return json({ status: true, task_ids: [] });

	console.info(`[browser backend] unsupported ${method} ${path}`);
	return json({ detail: `Unavailable in browser-only mode: ${method} ${path}` }, 404);
};

let installed = false;

export const installVirtualBackend = () => {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	localStorage.setItem('token', 'local');

	const nativeFetch = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request =
			input instanceof Request
				? new Request(input, init)
				: new Request(new URL(input.toString(), window.location.href), init);
		const url = new URL(request.url, window.location.href);
		if (url.origin === window.location.origin && browserPath(url).startsWith('/api/')) {
			return route(request);
		}
		return nativeFetch(request);
	};
};

export { virtualSocket } from './socket';
export const isVirtualBackend = true;
