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
}

const database = openDB<VirtualBackendSchema>('open-webui-browser', 1, {
	upgrade(db) {
		const chats = db.createObjectStore('chats', { keyPath: 'id' });
		chats.createIndex('by-updated', 'updated_at');
		chats.createIndex('by-folder', 'folder_id');

		const folders = db.createObjectStore('folders', { keyPath: 'id' });
		folders.createIndex('by-updated', 'updated_at');
	}
});

export const listChats = async () =>
	(await database).getAllFromIndex('chats', 'by-updated').then((items) => items.reverse());

export const getChat = async (id: string) => (await database).get('chats', id);
export const putChat = async (chat: LocalChat) => (await database).put('chats', chat);
export const deleteChat = async (id: string) => (await database).delete('chats', id);
export const clearChats = async () => (await database).clear('chats');

export const listFolders = async () =>
	(await database).getAllFromIndex('folders', 'by-updated').then((items) => items.reverse());

export const getFolder = async (id: string) => (await database).get('folders', id);
export const putFolder = async (folder: LocalFolder) => (await database).put('folders', folder);
export const deleteFolder = async (id: string) => (await database).delete('folders', id);

const SETTINGS_KEY = 'open-webui-browser-settings';

export const getSettings = () => {
	try {
		return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
	} catch {
		return {};
	}
};

export const putSettings = (settings: Record<string, any>) => {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	return settings;
};
