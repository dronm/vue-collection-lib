import assert from "node:assert/strict";
import test from "node:test";

import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h } from "vue";
import {
	routeLocationKey,
	routerKey,
	type RouteLocationNormalizedLoaded,
	type Router,
} from "vue-router";

import { useCollectionEditPage } from "../src/composables/form/useCollectionEditPage.ts";
import {
	cancelReferenceCreation,
	completeReferenceCreation,
	createReferenceCreationToken,
	isReferenceCreationMessage,
	isReferenceCreationQuery,
	makeReferenceCreationMessage,
	REFERENCE_CREATION_QUERY_PARAM,
	referenceCreationChannelName,
	referenceCreationTokenFromQuery,
} from "../src/utils/referenceCreation.ts";

const query = { [REFERENCE_CREATION_QUERY_PARAM]: "create-session" };

const withBrowser = async (
	callback: (browser: {
		messages: unknown[];
		closed: () => number;
		window: Window;
	}) => void | Promise<void>,
): Promise<void> => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
	const messages: unknown[] = [];
	let closeCount = 0;
	const browserWindow = {
		location: {
			origin: "https://example.test",
			search: `?${REFERENCE_CREATION_QUERY_PARAM}=create-session`,
		},
		opener: {
			closed: false,
			postMessage: (message: unknown, origin: string) => {
				assert.equal(origin, "https://example.test");
				messages.push(message);
			},
		},
		close: () => {
			closeCount += 1;
		},
		dispatchEvent: () => true,
	} as unknown as Window;

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: browserWindow,
	});
	Object.defineProperty(globalThis, "BroadcastChannel", {
		configurable: true,
		value: undefined,
	});

	try {
		await callback({
			messages,
			closed: () => closeCount,
			window: browserWindow,
		});
		// Let the successful completion close its child before restoring globals.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	} finally {
		if (originalWindow) {
			Object.defineProperty(globalThis, "window", originalWindow);
		} else {
			Reflect.deleteProperty(globalThis, "window");
		}
		if (originalChannel) {
			Object.defineProperty(globalThis, "BroadcastChannel", originalChannel);
		} else {
			Reflect.deleteProperty(globalThis, "BroadcastChannel");
		}
	}
};

test("reference creation uses its own validated query and message context", () => {
	const token = createReferenceCreationToken();
	const row = { id: 7, name: "Saved name" };
	const message = makeReferenceCreationMessage(token, { id: 7 }, row);

	assert.ok(token.length > 0);
	assert.ok(referenceCreationChannelName(token).endsWith(token));
	assert.equal(isReferenceCreationQuery({ __vclReferenceSelect: token }), false);
	assert.equal(isReferenceCreationQuery({}), false);
	assert.equal(isReferenceCreationQuery({ [REFERENCE_CREATION_QUERY_PARAM]: "  " }), false);
	assert.equal(isReferenceCreationQuery({ [REFERENCE_CREATION_QUERY_PARAM]: [token] }), false);
	assert.equal(referenceCreationTokenFromQuery(query), "create-session");
	assert.equal(isReferenceCreationMessage(message), true);
	assert.equal(isReferenceCreationMessage({ ...message, type: "vue-collection-lib:reference-selection" }), false);
	assert.equal(isReferenceCreationMessage({ ...message, token: "  " }), false);
	assert.equal(isReferenceCreationMessage({ ...message, key: null }), false);
	assert.equal(isReferenceCreationMessage({ ...message, key: undefined }), false);
	assert.equal(isReferenceCreationMessage({ ...message, row: null }), false);
	assert.equal(isReferenceCreationMessage({ ...message, row: [] }), false);
	assert.equal(isReferenceCreationMessage(makeReferenceCreationMessage(token, 0, row)), true);
});

test("creation completion and cancellation leave ordinary pages alone", async () => {
	await withBrowser(({ messages, closed }) => {
		assert.equal(completeReferenceCreation(7, { id: 7 }, { query: {} }), false);
		assert.equal(cancelReferenceCreation({}), false);
		assert.deepEqual(messages, []);
		assert.equal(closed(), 0);
	});
});

test("creation returns saved details to the same-origin opener", async () => {
	await withBrowser(({ messages, closed }) => {
		const detail = { id: 7, name: "Server normalized" };
		assert.equal(completeReferenceCreation({ id: 7 }, detail, {
			query,
			closeWindow: false,
		}), true);
		assert.deepEqual(messages, [makeReferenceCreationMessage("create-session", { id: 7 }, detail)]);
		assert.equal(closed(), 0);
		assert.equal(cancelReferenceCreation(query), true);
		assert.equal(closed(), 1);
	});
});

test("creation can return through a channel when the opener is unavailable", async () => {
	await withBrowser(({ window: browserWindow }) => {
		const messages: unknown[] = [];
		let channelClosed = false;
		const saved = { id: 8, name: "New record" };
		class TestChannel {
			constructor(name: string) {
				assert.equal(name, referenceCreationChannelName("create-session"));
			}

			postMessage(message: unknown): void {
				messages.push(message);
			}

			close(): void {
				channelClosed = true;
			}
		}
		Object.defineProperty(globalThis, "BroadcastChannel", {
			configurable: true,
			value: TestChannel,
		});
		browserWindow.opener = null;

		assert.equal(completeReferenceCreation(8, saved, { query, closeWindow: false }), true);
		assert.deepEqual(messages, [makeReferenceCreationMessage("create-session", 8, saved)]);
		assert.equal(channelClosed, true);
	});
});

test("failed transport keeps the creation page open for retry", async () => {
	await withBrowser(({ window: browserWindow, closed }) => {
		browserWindow.opener = null;
		assert.throws(
			() => completeReferenceCreation(7, { id: 7 }, { query }),
			/could not be returned/,
		);
		assert.equal(closed(), 0);
	});
});

test("a failed channel falls back to the opener", async () => {
	await withBrowser(({ messages }) => {
		class BrokenChannel {
			postMessage(): void {
				throw new Error("channel blocked");
			}

			close(): void {}
		}
		Object.defineProperty(globalThis, "BroadcastChannel", {
			configurable: true,
			value: BrokenChannel,
		});

		assert.equal(completeReferenceCreation(7, { id: 7 }, { query, closeWindow: false }), true);
		assert.equal(messages.length, 1);
	});
});

test("browser query defaults support simple custom creation forms", async () => {
	await withBrowser(({ messages }) => {
		assert.equal(completeReferenceCreation(7, { id: 7 }, { closeWindow: false }), true);
		assert.equal(messages.length, 1);
	});
});

type Model = { name: string };
type Detail = { id: number; name: string };
type Page = ReturnType<typeof useCollectionEditPage<Model, number, Model, Partial<Model>, Detail>>;

const makeEditPage = async (options: {
	query?: Record<string, unknown>;
	detail?: (key: number) => Promise<Detail>;
}) => {
	let page!: Page;
	let createCount = 0;
	const navigation: unknown[] = [];
	const app = createSSRApp({
		setup: () => {
			page = useCollectionEditPage<Model, number, Model, Partial<Model>, Detail>({
				api: {
					create: async () => {
						createCount += 1;
						return 0;
					},
					update: async () => ({ affectedRows: 1 }),
					detail: options.detail ?? (async (id) => ({ id, name: "Saved detail" })),
				},
				createRouteName: "ItemCreate",
				listRoute: { name: "ItemList" },
				keyFromRoute: () => 0,
				createModel: () => ({ name: "" }),
				fields: ["name"],
			});
			return () => h("div");
		},
	});
	app.provide(routeLocationKey, {
		name: "ItemCreate",
		query: options.query ?? query,
	} as unknown as RouteLocationNormalizedLoaded);
	app.provide(routerKey, {
		push: async (value: unknown) => {
			navigation.push(value);
		},
	} as unknown as Router);
	await renderToString(app);

	return {
		page,
		navigation,
		createCount: () => createCount,
	};
};

test("edit-page reference completion retries saved detail without a duplicate create", async () => {
	await withBrowser(async ({ messages }) => {
		let detailCount = 0;
		const { page, navigation, createCount } = await makeEditPage({
			detail: async (id) => {
				detailCount += 1;
				if (detailCount === 1) {
					throw new Error("detail temporarily unavailable");
				}
				return { id, name: "Server normalized" };
			},
		});

		await page.submit({ name: "Submitted name" });
		assert.equal(page.createdKey.value, 0);
		assert.equal(createCount(), 1);
		assert.deepEqual(messages, []);
		assert.match(page.errors.formErrors[0] ?? "", /detail temporarily unavailable/);

		await page.submit({ name: "Submitted name" });
		assert.equal(createCount(), 1);
		assert.equal(detailCount, 2);
		assert.deepEqual(messages, [makeReferenceCreationMessage("create-session", 0, {
			id: 0,
			name: "Server normalized",
		})]);
		assert.deepEqual(navigation, []);
		assert.deepEqual(page.errors.formErrors, []);
		assert.equal(page.completingReferenceCreation.value, false);
	});
});

test("edit-page delivery failure retries the saved record after transport recovers", async () => {
	await withBrowser(async ({ messages, window: browserWindow }) => {
		const opener = browserWindow.opener;
		browserWindow.opener = null;
		const { page, navigation, createCount } = await makeEditPage({});

		await page.submit({ name: "Submitted name" });
		assert.equal(page.createdKey.value, 0);
		assert.equal(createCount(), 1);
		assert.match(page.errors.formErrors[0] ?? "", /could not be returned/);
		assert.deepEqual(navigation, []);

		browserWindow.opener = opener;
		await page.submit({ name: "Submitted name" });
		assert.equal(createCount(), 1);
		assert.equal(messages.length, 1);
		assert.deepEqual(page.errors.formErrors, []);
	});
});

test("edit-page cancellation closes the child and ordinary creation keeps its redirect", async () => {
	await withBrowser(async ({ closed, messages }) => {
		const child = await makeEditPage({});
		await child.page.goBack();
		assert.equal(closed(), 1);
		assert.deepEqual(child.navigation, []);
		assert.deepEqual(messages, []);

		const ordinary = await makeEditPage({ query: {} });
		await ordinary.page.submit({ name: "Ordinary record" });
		assert.equal(ordinary.createCount(), 1);
		assert.deepEqual(ordinary.navigation, [{ name: "ItemList" }]);
		assert.equal(ordinary.page.createdKey.value, null);
	});
});
