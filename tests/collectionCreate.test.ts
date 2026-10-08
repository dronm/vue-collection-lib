import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isReactive } from "vue";
import * as v from "valibot";

import type { CollectionDefinition } from "../src/types/collectionDefinition.ts";
import { useCollectionCreate } from "../src/composables/form/useCollectionCreate.ts";

interface Row {
	id: number;
	name: string;
	price: number;
	amount: number;
	parent_id: number | null;
	updateOnly: string;
	createOnly: string;
}

interface Key {
	id: number;
}

interface Payload {
	name: string;
	price: number;
	amount: number;
	createOnly: string;
	parent_id?: number | null;
}

interface Detail extends Row {
	server_label: string;
}

type Definition = CollectionDefinition<Row, Key, Payload, Partial<Payload>, Detail>;

const createRow = (): Row => ({
	id: 0,
	name: "Draft",
	price: 10,
	amount: 20,
	parent_id: null,
	updateOnly: "update only",
	createOnly: "create only",
});

const savedDetail = (key: Key): Detail => ({
	...createRow(),
	id: key.id,
	name: "Saved by server",
	server_label: "Authoritative label",
});

const defineCollection = (overrides: Partial<Definition> = {}): Definition => ({
	titleKey: "Items.title",
	dataKey: "id",
	getKey: (row) => ({ id: row.id }),
	createRow,
	columns: [
		{ field: "id", headerKey: "id", dataType: "number" },
		{ field: "name", headerKey: "name", editable: true },
		{ field: "price", headerKey: "price", editable: true, dataType: "number" },
		{ field: "amount", headerKey: "amount", editable: true, dataType: "number" },
		{ field: "parent_id", headerKey: "parent" },
		{ field: "updateOnly", headerKey: "updateOnly", editable: true, createEditable: false },
		{ field: "createOnly", headerKey: "createOnly", editable: false, createEditable: true },
	],
	api: {
		list: async () => ({ rows: [], agg: { tot_count: 0 } }),
		create: async () => ({ id: 7 }),
		detail: async (key) => savedDetail(key),
	},
	...overrides,
});

test("generated creation uses fresh defaults, creation fields and forced context values", async () => {
	let payload: Payload | undefined;
	let receivedContext: unknown;
	const context = { kind: "item" as const, initialValues: { parent_id: 12, name: "Initial" } };
	const definition = defineCollection();
	definition.createRow = (value) => {
		receivedContext = value;
		return createRow();
	};
	definition.api.create = async (value) => {
		payload = value;
		return { id: 9 };
	};
	const creator = useCollectionCreate({ collection: definition, context });

	assert.equal(isReactive(creator.draft), true);
	assert.equal(receivedContext, context);
	assert.equal(creator.draft.parent_id, 12);
	assert.equal(creator.draft.name, "Initial");
	assert.deepEqual(creator.editableColumns.value.map((column) => column.field), [
		"name", "price", "amount", "createOnly",
	]);
	creator.draft.name = "Overridden draft";
	const result = await creator.submit();

	assert.deepEqual(payload, {
		name: "Initial",
		price: 10,
		amount: 20,
		createOnly: "create only",
		parent_id: 12,
	});
	assert.equal(result?.detail.server_label, "Authoritative label");
	assert.equal(result?.detail.id, 9);
	assert.deepEqual(result?.key, { id: 9 });
	assert.equal(createRow().id, 0);
});

test("custom create mapping runs before schema and asynchronous custom validation", async () => {
	const order: string[] = [];
	let payload: Payload | undefined;
	const definition = defineCollection({
		createModel: (row) => {
			order.push("mapper");
			return { name: ` ${row.name} `, price: row.price, amount: row.amount, createOnly: row.createOnly };
		},
		createSchema: v.object({
			name: v.pipe(v.string(), v.trim()),
			price: v.number(),
			amount: v.number(),
			createOnly: v.string(),
			parent_id: v.optional(v.nullable(v.number())),
		}),
		validateCreate: async (model, row) => {
			order.push("validator");
			assert.equal(model.name, "Draft");
			assert.equal(row.name, "Draft");
			assert.equal(model.parent_id, 11);
			await Promise.resolve();
			return { ...model, name: model.name.toUpperCase() };
		},
	});
	definition.api.create = async (model) => {
		order.push("create");
		payload = model;
		return { id: 3 };
	};
	const creator = useCollectionCreate({
		collection: definition,
		context: { initialValues: { parent_id: 11 } },
	});

	await creator.submit();

	assert.deepEqual(order, ["mapper", "validator", "create"]);
	assert.equal(payload?.name, "DRAFT");
	assert.equal(payload?.parent_id, 11);
});

test("schema failures retain the draft and prevent create until corrected", async () => {
	let createCalls = 0;
	const definition = defineCollection({
		createSchema: v.object({
			name: v.pipe(v.string(), v.minLength(1, "Name required")),
			price: v.number(),
			amount: v.number(),
			createOnly: v.string(),
		}),
	});
	definition.api.create = async () => {
		createCalls += 1;
		return { id: 3 };
	};
	const creator = useCollectionCreate({ collection: definition });
	creator.draft.name = "";
	assert.equal(await creator.submit(), null);
	assert.equal(createCalls, 0);
	assert.equal(creator.draft.name, "");
	assert.equal(creator.errors.first("name"), "Name required");

	await creator.updateValue(definition.columns[1]!, "Corrected");
	assert.ok(await creator.submit());
	assert.equal(createCalls, 1);
	assert.equal(creator.errors.has("name"), false);
});

test("generated fields normalize and finish asynchronous dependent updates before saving", async () => {
	let completeHook!: () => void;
	const hookCompleted = new Promise<void>((resolve) => {
		completeHook = resolve;
	});
	let payload: Payload | undefined;
	const definition = defineCollection();
	const priceColumn = definition.columns[2]!;
	priceColumn.normalizeValue = (value) => Math.round(Number(value) * 100) / 100;
	priceColumn.setValue = async (row, value) => {
		assert.equal(isReactive(row), true);
		assert.equal(value, 12.35);
		assert.equal(row.price, 12.35);
		await hookCompleted;
		row.amount = row.price * 2;
	};
	definition.api.create = async (model) => {
		payload = model;
		return { id: 2 };
	};
	const creator = useCollectionCreate({ collection: definition });
	const updating = creator.updateValue(priceColumn, 12.345);
	const submitting = creator.submit();
	await Promise.resolve();
	assert.equal(payload, undefined);
	assert.equal(creator.submitting.value, true);
	completeHook();
	await updating;
	assert.ok(await submitting);
	assert.equal(payload?.price, 12.35);
	assert.equal(payload?.amount, 24.7);
});

test("failed dependent hooks block submission and can recover after the field is edited", async () => {
	let createCalls = 0;
	const definition = defineCollection();
	const priceColumn = definition.columns[2]!;
	priceColumn.setValue = async () => {
		throw new Error("Unable to calculate amount");
	};
	definition.api.create = async () => {
		createCalls += 1;
		return { id: 2 };
	};
	const creator = useCollectionCreate({ collection: definition });
	await creator.updateValue(priceColumn, 3);
	assert.equal(await creator.submit(), null);
	assert.equal(createCalls, 0);
	assert.deepEqual(creator.errors.formErrors, ["Unable to calculate amount"]);
	priceColumn.setValue = (row) => {
		row.amount = row.price * 2;
	};
	await creator.updateValue(priceColumn, 4);
	assert.ok(await creator.submit());
	assert.equal(createCalls, 1);
});

test("an obsolete field-hook failure cannot block the latest corrected value", async () => {
	let rejectFirst!: (error: Error) => void;
	const firstHook = new Promise<void>((_resolve, reject) => {
		rejectFirst = reject;
	});
	let payload: Payload | undefined;
	const definition = defineCollection();
	const priceColumn = definition.columns[2]!;
	priceColumn.setValue = async (_row, value) => {
		if (value === 2) {
			await firstHook;
		}
	};
	definition.api.create = async (model) => {
		payload = model;
		return { id: 2 };
	};
	const creator = useCollectionCreate({ collection: definition });
	const firstUpdate = creator.updateValue(priceColumn, 2);
	await creator.updateValue(priceColumn, 3);
	const saving = creator.submit();
	await Promise.resolve();
	assert.equal(payload, undefined);
	rejectFirst(new Error("Obsolete calculation failure"));
	await firstUpdate;
	assert.ok(await saving);
	assert.equal(payload?.price, 3);
	assert.deepEqual(creator.errors.formErrors, []);
});

test("an obsolete field-hook success cannot clear the latest failed value", async () => {
	let finishFirst!: () => void;
	const firstHook = new Promise<void>((resolve) => {
		finishFirst = resolve;
	});
	let createCalls = 0;
	const definition = defineCollection();
	const priceColumn = definition.columns[2]!;
	priceColumn.setValue = async (_row, value) => {
		if (value === 2) {
			await firstHook;
		} else if (value === 3) {
			throw new Error("Latest calculation failure");
		}
	};
	definition.api.create = async () => {
		createCalls += 1;
		return { id: 2 };
	};
	const creator = useCollectionCreate({ collection: definition });
	const firstUpdate = creator.updateValue(priceColumn, 2);
	await creator.updateValue(priceColumn, 3);
	finishFirst();
	await firstUpdate;
	assert.equal(await creator.submit(), null);
	assert.equal(createCalls, 0);
	assert.deepEqual(creator.errors.formErrors, ["Latest calculation failure"]);
	await creator.updateValue(priceColumn, 4);
	assert.ok(await creator.submit());
	assert.equal(createCalls, 1);
});

test("failed create requests retain input and allow a safe submission retry", async () => {
	let createCalls = 0;
	let detailCalls = 0;
	const definition = defineCollection();
	definition.api.create = async () => {
		createCalls += 1;
		if (createCalls === 1) {
			throw new Error("Create failed");
		}
		return { id: 2 };
	};
	definition.api.detail = async (key) => {
		detailCalls += 1;
		return savedDetail(key);
	};
	const creator = useCollectionCreate({ collection: definition });
	creator.draft.name = "Retained";

	assert.equal(await creator.submit(), null);
	assert.equal(creator.draft.name, "Retained");
	assert.equal(creator.created.value, false);
	assert.equal(detailCalls, 0);
	assert.deepEqual(creator.errors.formErrors, ["Create failed"]);
	assert.ok(await creator.submit());
	assert.equal(createCalls, 2);
	assert.equal(detailCalls, 1);
});

test("simultaneous save attempts issue one creation request", async () => {
	let finishCreate!: (key: Key) => void;
	let createCalls = 0;
	const definition = defineCollection();
	definition.api.create = async () => {
		createCalls += 1;
		return await new Promise<Key>((resolve) => {
			finishCreate = resolve;
		});
	};
	const creator = useCollectionCreate({ collection: definition });
	const first = creator.submit();
	const second = await creator.submit();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(second, null);
	assert.equal(createCalls, 1);
	finishCreate({ id: 8 });
	assert.ok(await first);
	assert.equal(creator.submitting.value, false);
});

test("failed saved-detail loading retries selection without creating another record", async () => {
	let createCalls = 0;
	let detailCalls = 0;
	const definition = defineCollection();
	definition.api.create = async () => {
		createCalls += 1;
		return { id: 10 };
	};
	definition.api.detail = async (key) => {
		detailCalls += 1;
		if (detailCalls === 1) {
			throw new Error("Unable to load saved item");
		}
		return savedDetail(key);
	};
	const creator = useCollectionCreate({ collection: definition });

	assert.equal(await creator.submit(), null);
	assert.equal(creator.created.value, true);
	assert.deepEqual(creator.savedKey.value, { id: 10 });
	assert.deepEqual(creator.errors.formErrors, ["Unable to load saved item"]);
	await creator.updateValue(definition.columns[1]!, "Second draft");
	assert.equal(creator.draft.name, "Draft");
	const result = await creator.submit();
	assert.ok(result);
	assert.equal(createCalls, 1);
	assert.equal(detailCalls, 2);
	assert.equal(result.detail.name, "Saved by server");
	assert.equal(await creator.submit(), result);
	assert.equal(createCalls, 1);
	assert.equal(detailCalls, 2);
});

test("loadCreated adapters support collections without a detail endpoint", async () => {
	const definition = defineCollection({ loadCreated: async (key) => savedDetail(key) });
	delete definition.api.detail;
	const creator = useCollectionCreate({ collection: definition });
	assert.equal((await creator.submit())?.detail.id, 7);
});

test("missing creation metadata fails before any creation request", async () => {
	for (const missing of ["createRow", "create", "detail"] as const) {
		let createCalls = 0;
		const definition = defineCollection();
		definition.api.create = async () => {
			createCalls += 1;
			return { id: 1 };
		};
		if (missing === "createRow") {
			delete definition.createRow;
		} else {
			delete definition.api[missing];
		}
		const creator = useCollectionCreate({ collection: definition });
		assert.equal(creator.available.value, false);
		assert.equal(await creator.submit(), null);
		assert.equal(createCalls, 0);
		assert.match(creator.errors.formErrors[0] ?? "", /Collection creation requires/);
	}
});

test("embedded creation does not dispatch parent form completion or dirty events", async () => {
	const dispatches: string[] = [];
	const global = globalThis as unknown as { window?: { dispatchEvent: (event: Event) => void } };
	const previousWindow = global.window;
	global.window = { dispatchEvent: (event) => { dispatches.push(event.type); } };
	try {
		const creator = useCollectionCreate({ collection: defineCollection() });
		await creator.submit();
		assert.deepEqual(dispatches, []);
	} finally {
		if (previousWindow === undefined) {
			delete global.window;
		} else {
			global.window = previousWindow;
		}
	}
	const source = await readFile(
		new URL("../src/components/form/CollectionCreateForm.vue", import.meta.url),
		"utf8",
	);
	assert.match(source, /data-collection-ignore-dirty/);
	assert.match(source, /@submit\.prevent\.stop="submit"/);
});
