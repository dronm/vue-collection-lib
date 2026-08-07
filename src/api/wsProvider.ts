import {
	inject,
	type App,
	type InjectionKey,
} from "vue";

import type { WSManager } from "./wsManager";

const wsManagerKey: InjectionKey<WSManager> = Symbol("collection-ws-manager");

// provideWSManager makes a shared WebSocket manager available to library components.
export const provideWSManager = (
	app: App,
	manager: WSManager,
): void => {
	app.provide(wsManagerKey, manager);
};

// useWSManager returns the WebSocket manager configured by the host application.
export const useWSManager = (): WSManager | null => {
	return inject(wsManagerKey, null);
};
