import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";

import Aura from "@primeuix/themes/aura";
import PrimeVue from "primevue/config";
import "primeicons/primeicons.css";

import {
	collectionLibEn,
	collectionLibRu,
} from "@katren/vue-collection-lib/locales";

import App from "./App.vue";

const i18n = createI18n({
	legacy: false,
	locale: "en",
	fallbackLocale: "en",
	messages: {
		en: {
			...collectionLibEn,
			Product: {
				fields: {
					id: "ID",
					name: "Name",
					category: "Category",
					price: "Price",
					active: "Active",
				},
			},
		},
		ru: {
			...collectionLibRu,
		},
	},
});

const router = createRouter({
	history: createWebHistory(),
	routes: [],
});

createApp(App)
	.use(PrimeVue, {
		theme: {
			preset: Aura,
		},
	})
	.use(i18n)
	.use(router)
	.mount("#app");
