import { openDB, type DBSchema } from 'idb';

export type LocalChat = {
	id: string;
	user_id: string;
	title: string;
	chat: Record<string, any>;
	created_at: number;
	updated_at: number;
	share_id: null;
	archived: boolean;
	pinned: boolean;
	folder_id: string | null;
	meta: Record<string, any>;
	last_read_at?: number;
	variables?: Record<string, any>;
};

export type LocalFolder = {
	id: string;
	user_id: string;
	name: string;
	parent_id: string | null;
	data: Record<string, any>;
	meta: Record<string, any>;
	is_expanded: boolean;
	created_at: number;
	updated_at: number;
};

export type LocalMcpPackage = {
	id: string;
	package_name: string;
	entry_url: string;
	registry_url: string;
	module_urls: string[];
	module_hashes: Record<string, string>;
	modules: Record<string, string>;
	installed_at: number;
};

interface VirtualBackendSchema extends DBSchema {
	chats: {
		key: string;
		value: LocalChat;
		indexes: { 'by-updated': number; 'by-folder': string };
	};
	folders: {
		key: string;
		value: LocalFolder;
		indexes: { 'by-updated': number };
	};
	mcpPackages: {
		key: string;
		value: LocalMcpPackage;
	};
}

let database: ReturnType<typeof openDB<VirtualBackendSchema>> | null = null;
const getDatabase = () => {
	if (!database) {
		database = openDB<VirtualBackendSchema>('open-webui-browser', 2, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const chats = db.createObjectStore('chats', { keyPath: 'id' });
					chats.createIndex('by-updated', 'updated_at');
					chats.createIndex('by-folder', 'folder_id');

					const folders = db.createObjectStore('folders', { keyPath: 'id' });
					folders.createIndex('by-updated', 'updated_at');
				}
				if (oldVersion < 2) {
					db.createObjectStore('mcpPackages', { keyPath: 'id' });
				}
			}
		});
	}
	return database;
};

export const listChats = async () =>
	(await getDatabase()).getAllFromIndex('chats', 'by-updated').then((items) => items.reverse());

export const getChat = async (id: string) => (await getDatabase()).get('chats', id);
export const putChat = async (chat: LocalChat) => (await getDatabase()).put('chats', chat);
export const deleteChat = async (id: string) => (await getDatabase()).delete('chats', id);
export const clearChats = async () => (await getDatabase()).clear('chats');

export const listFolders = async () =>
	(await getDatabase()).getAllFromIndex('folders', 'by-updated').then((items) => items.reverse());

export const getFolder = async (id: string) => (await getDatabase()).get('folders', id);
export const putFolder = async (folder: LocalFolder) =>
	(await getDatabase()).put('folders', folder);
export const deleteFolder = async (id: string) => (await getDatabase()).delete('folders', id);

export const getMcpPackage = async (id: string) => (await getDatabase()).get('mcpPackages', id);
export const putMcpPackage = async (value: LocalMcpPackage) =>
	(await getDatabase()).put('mcpPackages', value);
export const deleteMcpPackage = async (id: string) =>
	(await getDatabase()).delete('mcpPackages', id);

const SETTINGS_KEY = 'open-webui-browser-settings';
const DEFAULT_SETTINGS = { ui: { params: { tool_approval_mode: 'ask' } } };

export const getSettings = () => {
	try {
		const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
		return {
			...DEFAULT_SETTINGS,
			...stored,
			ui: {
				...DEFAULT_SETTINGS.ui,
				...(stored?.ui ?? {}),
				params: { ...DEFAULT_SETTINGS.ui.params, ...(stored?.ui?.params ?? {}) }
			}
		};
	} catch {
		return DEFAULT_SETTINGS;
	}
};

export const putSettings = (settings: Record<string, any>) => {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	return settings;
};
