import {
	provideWSManager,
	WSManager,
} from "@katren/vue-collection-lib";

export default defineNuxtPlugin((nuxtApp) => {
	const wsManager = new WSManager("/ws", {
		reconnectInterval: 3_000,
		maxReconnectAttempts: 0,
	});

	provideWSManager(nuxtApp.vueApp, wsManager);
	wsManager.connect();
});
