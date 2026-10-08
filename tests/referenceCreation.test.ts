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
import { useReferenceCreation } from "../src/composables/useReferenceCreation.ts";
import {
	clearReferenceCreationDefaults,
	consumeReferenceCreationDefaults,
	prepareReferenceCreationDefaults,
	readReferenceCreationDefaults,
	referenceCreationDefaultsStorageKey,
} from "../src/utils/referenceCreationDefaults.ts";
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
		storage: Map<string, string>;
	}) => void | Promise<void>,
): Promise<void> => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
	const messages: unknown[] = [];
	const storage = new Map<string, string>();
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
		sessionStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		},
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
			storage,
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
	create?: () => Promise<number>;
	routeName?: string;
	copyKey?: number;
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
						return options.create ? await options.create() : 0;
					},
					update: async () => ({ affectedRows: 1 }),
					detail: options.detail ?? (async (id) => ({ id, name: "Saved detail" })),
				},
				createRouteName: "ItemCreate",
				listRoute: { name: "ItemList" },
				keyFromRoute: () => 0,
				createModel: () => ({ name: "" }),
				fromDetail: (detail) => ({ name: detail.name }),
				copyKeyFromRoute: () => options.copyKey ?? null,
				fields: ["name"],
			});
			return () => h("div");
		},
	});
	app.provide(routeLocationKey, {
		name: options.routeName ?? "ItemCreate",
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

test("creation defaults are isolated by token and consumed separately from read", async () => {
	await withBrowser(({ storage }) => {
		prepareReferenceCreationDefaults("create-session", { name: "Typed value" });
		prepareReferenceCreationDefaults("other-session", { name: "Other value" });
		assert.deepEqual(readReferenceCreationDefaults(query), { name: "Typed value" });
		assert.deepEqual(readReferenceCreationDefaults(query), { name: "Typed value" });
		assert.equal(readReferenceCreationDefaults({}), undefined);
		assert.equal(readReferenceCreationDefaults({ __vclReferenceSelect: "create-session" }), undefined);
		assert.equal(readReferenceCreationDefaults({ [REFERENCE_CREATION_QUERY_PARAM]: ["create-session"] }), undefined);
		assert.deepEqual(consumeReferenceCreationDefaults(query), { name: "Typed value" });
		assert.equal(readReferenceCreationDefaults(query), undefined);
		assert.equal(storage.has(referenceCreationDefaultsStorageKey("create-session")), false);
		assert.deepEqual(readReferenceCreationDefaults({ [REFERENCE_CREATION_QUERY_PARAM]: "other-session" }), {
			name: "Other value",
		});
		clearReferenceCreationDefaults("other-session");
		assert.equal(storage.size, 0);
	});
});

test("malformed and mismatched defaults cannot prefill a creation form", async () => {
	await withBrowser(({ storage }) => {
		const key = referenceCreationDefaultsStorageKey("create-session");
		for (const entry of [
			"{invalid json",
			JSON.stringify({ token: "another-session", values: { name: "Wrong" } }),
			JSON.stringify({ token: "create-session", values: ["Wrong"] }),
			'{"token":"create-session","values":{"__proto__":{"polluted":true}}}',
		]) {
			storage.set(key, entry);
			assert.equal(readReferenceCreationDefaults(query), undefined);
			assert.equal(storage.has(key), false);
		}
	});
});

test("page prefill rejects lossy values and reports blocked storage before opening", async () => {
	await withBrowser(({ window: browserWindow, storage }) => {
		for (const values of [
			{ name: undefined },
			{ name: () => "Wrong" },
			{ name: NaN },
			{ name: new Date() },
			{ name: 1n },
		]) {
			assert.throws(() => prepareReferenceCreationDefaults("create-session", values), /JSON-compatible/);
		}
		Object.defineProperty(browserWindow, "sessionStorage", {
			configurable: true,
			get: () => {
				throw new Error("blocked");
			},
		});
		assert.doesNotThrow(() => prepareReferenceCreationDefaults("create-session", {}));
		assert.throws(() => prepareReferenceCreationDefaults("create-session", { name: "Typed" }), /session storage is unavailable/);
		assert.doesNotThrow(() => clearReferenceCreationDefaults("create-session"));
		assert.equal(storage.size, 0);
	});
});

const makeCreationHelpers = async (routeQuery: Record<string, unknown>) => {
	let shell!: ReturnType<typeof useReferenceCreation>;
	let form!: ReturnType<typeof useReferenceCreation>;
	const app = createSSRApp({
		setup: () => {
			shell = useReferenceCreation();
			form = useReferenceCreation();
			return () => h("div");
		},
	});
	app.provide(routeLocationKey, {
		query: routeQuery,
	} as unknown as RouteLocationNormalizedLoaded);
	await renderToString(app);
	return { shell, form };
};

test("custom form defaults are stable and apply once to authorized fields", async () => {
	await withBrowser(async () => {
		prepareReferenceCreationDefaults("create-session", {
			name: "Typed name",
			optional_name: "Authorized optional",
			unknown_field: "Ignore",
		});
		const { shell, form } = await makeCreationHelpers(query);
		assert.deepEqual(shell.defaultValues, form.defaultValues);
		const model: { name: string; optional_name?: string } = { name: "Factory default" };
		assert.equal(form.applyDefaultValues(model, ["optional_name"]), model);
		assert.deepEqual(model, { name: "Typed name", optional_name: "Authorized optional" });
		model.name = "User correction";
		form.applyDefaultValues(model);
		assert.equal(model.name, "User correction");
		assert.equal(shell.consumeDefaultValues(), undefined);
		assert.equal(form.consumeDefaultValues(), undefined);
		assert.equal(form.defaultValues?.name, "Typed name");
	});
});

test("a changed creation token cannot receive a hook's previous defaults", async () => {
	await withBrowser(async () => {
		prepareReferenceCreationDefaults("create-session", { name: "First name" });
		prepareReferenceCreationDefaults("other-session", { name: "Second name" });
		const mutableQuery = { ...query };
		const { form } = await makeCreationHelpers(mutableQuery);
		mutableQuery[REFERENCE_CREATION_QUERY_PARAM] = "other-session";
		const model = { name: "Factory" };
		form.applyDefaultValues(model);
		assert.equal(model.name, "Factory");
		assert.deepEqual(readReferenceCreationDefaults(mutableQuery), { name: "Second name" });
	});
});

test("a saved record cannot be returned under a changed or missing creation token", async () => {
	await withBrowser(async ({ messages, closed }) => {
		const mutableQuery: Record<string, unknown> = { ...query };
		let detailCount = 0;
		const { page, navigation, createCount } = await makeEditPage({
			query: mutableQuery,
			detail: async (id) => {
				detailCount += 1;
				if (detailCount === 1) {
					throw new Error("temporary detail failure");
				}
				return { id, name: "Saved detail" };
			},
		});

		await page.submit({ name: "New record" });
		assert.equal(page.createdKey.value, 0);
		mutableQuery[REFERENCE_CREATION_QUERY_PARAM] = "different-session";
		await page.submit({ name: "New record" });
		assert.match(page.errors.formErrors[0] ?? "", /session has changed/);
		assert.equal(createCount(), 1);
		assert.deepEqual(messages, []);

		delete mutableQuery[REFERENCE_CREATION_QUERY_PARAM];
		await page.submit({ name: "New record" });
		assert.match(page.errors.formErrors[0] ?? "", /session has changed/);
		assert.equal(createCount(), 1);
		assert.deepEqual(navigation, []);
		assert.deepEqual(messages, []);
		await page.goBack();
		assert.equal(closed(), 1);
		assert.deepEqual(navigation, []);

		mutableQuery[REFERENCE_CREATION_QUERY_PARAM] = "create-session";
		await page.submit({ name: "New record" });
		assert.equal(createCount(), 1);
		assert.deepEqual(messages, [makeReferenceCreationMessage("create-session", 0, {
			id: 0,
			name: "Saved detail",
		})]);
	});
});

test("a creation token removed during POST still retains its saved key for retry", async () => {
	await withBrowser(async ({ messages }) => {
		const mutableQuery: Record<string, unknown> = { ...query };
		const { page, navigation, createCount } = await makeEditPage({
			query: mutableQuery,
			create: async () => {
				delete mutableQuery[REFERENCE_CREATION_QUERY_PARAM];
				return 0;
			},
		});

		await page.submit({ name: "New record" });
		assert.equal(page.createdKey.value, 0);
		assert.match(page.errors.formErrors[0] ?? "", /session has changed/);
		await page.submit({ name: "New record" });
		assert.equal(createCount(), 1);
		assert.deepEqual(navigation, []);
		assert.deepEqual(messages, []);
	});
});

test("ordinary page hooks do not acquire another creation session after setup", async () => {
	await withBrowser(async ({ closed, messages }) => {
		const mutableQuery: Record<string, unknown> = {};
		const { form } = await makeCreationHelpers(mutableQuery);
		const { page, navigation, createCount } = await makeEditPage({ query: mutableQuery });
		mutableQuery[REFERENCE_CREATION_QUERY_PARAM] = "later-session";

		assert.equal(form.cancel(), false);
		assert.throws(() => form.complete(7, { id: 7 }), /session has changed/);
		assert.equal(closed(), 0);
		await page.submit({ name: "Ordinary record" });
		assert.equal(createCount(), 1);
		assert.deepEqual(navigation, [{ name: "ItemList" }]);
		assert.deepEqual(messages, []);
		assert.equal(page.createdKey.value, null);
	});
});

test("edit-page defaults seed its first create load and preserve user edits on reload and retry", async () => {
	await withBrowser(async ({ messages }) => {
		prepareReferenceCreationDefaults("create-session", { name: "Typed name" });
		let detailCount = 0;
		const { page, createCount } = await makeEditPage({
			detail: async (id) => {
				detailCount += 1;
				if (detailCount === 1) {
					throw new Error("temporary detail error");
				}
				return { id, name: "Saved correction" };
			},
		});
		await page.load();
		assert.equal(page.model.value.name, "Typed name");
		assert.equal(readReferenceCreationDefaults(query), undefined);
		page.model.value.name = "User correction";
		await page.load();
		assert.equal(page.model.value.name, "User correction");
		await page.submit(page.model.value);
		await page.submit(page.model.value);
		assert.equal(page.model.value.name, "User correction");
		assert.equal(createCount(), 1);
		assert.equal(messages.length, 1);
	});
});

test("page defaults do not affect ordinary create, edit or copy loading", async () => {
	await withBrowser(async () => {
		prepareReferenceCreationDefaults("create-session", { name: "Typed name" });
		const ordinary = await makeEditPage({ query: {} });
		await ordinary.page.load();
		assert.equal(ordinary.page.model.value.name, "");
		const edit = await makeEditPage({ routeName: "ItemEdit" });
		await edit.page.load();
		assert.equal(edit.page.model.value.name, "Saved detail");
		const copy = await makeEditPage({ copyKey: 7 });
		await copy.page.load();
		assert.equal(copy.page.model.value.name, "Saved detail");
		assert.deepEqual(readReferenceCreationDefaults(query), { name: "Typed name" });
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
