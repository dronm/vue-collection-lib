import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isProxy, isReactive, nextTick, watchEffect } from "vue";

import { Conn } from "../src/api/Conn.ts";
import {
	buildCollectionQuery,
	CollectionRowValidationError,
	createCrudApi,
	normalizeCollectionResponse,
} from "../src/api/createCrudApi.ts";
import * as v from "valibot";
import { transformJSON } from "../src/api/transformJSON.ts";
import { makeCreateModel } from "../src/components/crudGrid/gridUtils.ts";
import {
	applyGridInlineValue,
	getReactiveGridEditRow,
} from "../src/components/crudGrid/inlineEditing.ts";
import type { GridColumn } from "../src/components/crudGrid/types.ts";
import { useCollectionFormSubmit } from "../src/composables/form/useCollectionFormSubmit.ts";
import { useFormMutation } from "../src/composables/form/useFormMutation.ts";
import {
	createReferenceSelectionToken,
	isReferenceSelectionMessage,
	isReferenceSelectionQuery,
	makeReferenceSelectionMessage,
	referenceSelectionChannelName,
	referenceSelectionTokenFromQuery,
} from "../src/utils/referenceSelection.ts";

test("normalizes collection totals", () => {
	const result = normalizeCollectionResponse<{ id: number }>({
		rows: [{ id: 1 }],
		agg: {
			total: "12",
		},
	});

	assert.equal(result.agg.tot_count, 12);
	assert.deepEqual(result.rows, [{ id: 1 }]);
});

test("reports the collection row and field that failed schema validation", async () => {
	const schema = v.object({
		id: v.number(),
		supplier: v.object({
			inn: v.string(),
		}),
	});
	const api = createCrudApi({
		api: {
			get: async <T>(): Promise<T> => ({
				rows: [{ id: 7, supplier: { inn: 123 } }],
				agg: { tot_count: 1 },
			}) as T,
			post: async <T>(): Promise<T> => ({} as T),
			patch: async <T>(): Promise<T> => ({} as T),
			delete: async <T>(): Promise<T> => ({} as T),
		},
		basePath: "/items",
		getKeyValue: (key: number) => key,
		fromListDTO: (dto: unknown) => v.parse(schema, dto),
		fromDetailDTO: (dto: unknown) => v.parse(schema, dto),
	});

	await assert.rejects(
		api.list(),
		(err: unknown) => {
			assert.ok(err instanceof CollectionRowValidationError);
			assert.match(err.message, /Invalid collection row 1 \(id: 7\)/);
			assert.match(err.message, /rows\[0\]\.supplier\.inn:/);
			return true;
		},
	);
});

test("builds collection query parameters", () => {
	assert.deepEqual(
		buildCollectionQuery({ from: 0, count: 20 }, "csv"),
		{
			params: JSON.stringify({ from: 0, count: 20 }),
			format: "csv",
		},
	);
});

test("supports composite REST key paths", async () => {
	const endpoints: string[] = [];
	const api = createCrudApi({
		api: {
			get: async <T>(endpoint: string): Promise<T> => {
				endpoints.push(endpoint);
				return { id: 1 } as T;
			},
			post: async <T>(): Promise<T> => {
				return {} as T;
			},
			patch: async <T>(): Promise<T> => {
				return {} as T;
			},
			delete: async <T>(): Promise<T> => {
				return {} as T;
			},
		},
		basePath: "/items",
		getKeyPath: (key: { groupId: number; itemId: string }) => [
			key.groupId,
			key.itemId,
		],
		fromListDTO: (dto: { id: number }) => dto,
		fromDetailDTO: (dto: { id: number }) => dto,
	});

	await api.detail({ groupId: 57, itemId: "66/а" });

	assert.equal(endpoints[0], "/items/57/66%2F%D0%B0");
});

test("detects nested reference key changes", () => {
	type Detail = {
		owner: {
			keys: {
				id: number;
			};
			descr: string;
		};
	};
	type Update = {
		owner?: {
			id: number;
		};
	};

	const mutation = useFormMutation<Detail, Update, Update>({
		fields: [
			{
				detailField: "owner",
				kind: "reference",
				reference: {
					mode: "keys",
				},
			},
		],
	});

	mutation.setInitialModel({
		owner: {
			keys: { id: 1 },
			descr: "Same description",
		},
	});

	assert.deepEqual(
		mutation.buildUpdateModel({
			owner: {
				keys: { id: 2 },
				descr: "Same description",
			},
		}),
		{
			owner: { id: 2 },
		},
	);
});

test("accepts zero as an edit key", async () => {
	const updates: Array<{ key: number; model: { name?: string } }> = [];
	const submit = useCollectionFormSubmit<
		{ name: string },
		number,
		{ name: string },
		{ name?: string }
	>({
		api: {
			create: async () => 1,
			update: async (key, model) => {
				updates.push({ key, model });
				return { affectedRows: 1 };
			},
		},
		mode: "edit",
		key: 0,
		fields: ["name"],
	});

	submit.setInitialModel({ name: "Before" });
	await submit.submit({ name: "After" });

	assert.deepEqual(updates, [
		{
			key: 0,
			model: { name: "After" },
		},
	]);
});

test("sends false JSON request bodies and allows timeout zero", async () => {
	const originalFetch = globalThis.fetch;
	let requestBody: BodyInit | null | undefined;

	globalThis.fetch = async (_input, init) => {
		requestBody = init?.body;
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
			},
		});
	};

	try {
		const conn = new Conn("https://example.test/api", 0);
		await conn.post("/flag", false);

		assert.equal(conn.timeout, 0);
		assert.equal(requestBody, "false");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("converts only valid ISO date strings", () => {
	const result = transformJSON({
		valid: "2026-07-14T10:00:00Z",
		invalid: "2026-99-99",
	});

	assert.ok(result.valid instanceof Date);
	assert.equal(result.invalid, "2026-99-99");
});


test("builds isolated reference selection sessions", () => {
	const token = createReferenceSelectionToken();
	const message = makeReferenceSelectionMessage(token, {
		id: 7,
		name: "Russia",
	});

	assert.ok(token.length > 0);
	assert.ok(referenceSelectionChannelName(token).endsWith(token));
	assert.equal(isReferenceSelectionMessage(message), true);
	assert.equal(isReferenceSelectionMessage({ ...message, token: "" }), false);
	assert.equal(isReferenceSelectionMessage({ ...message, row: null }), false);
});

test("builds inline create payload from editable columns", () => {
	type Row = {
		id: number;
		name: string;
		active: boolean;
	};
	type New = {
		name: string;
		active: boolean;
	};

	const model = makeCreateModel<Row, New>(
		{
			id: 0,
			name: "New row",
			active: true,
		},
		[
			{
				field: "id",
				headerKey: "id",
			},
			{
				field: "name",
				headerKey: "name",
				editable: true,
			},
			{
				field: "active",
				headerKey: "active",
				editable: true,
			},
		],
	);

	assert.deepEqual(model, {
		name: "New row",
		active: true,
	});
});

test("detects reference selection mode from a route query", () => {
	assert.equal(isReferenceSelectionQuery({}), false);
	assert.equal(isReferenceSelectionQuery({ __vclReferenceSelect: "" }), false);
	assert.equal(isReferenceSelectionQuery({ __vclReferenceSelect: "  " }), false);
	assert.equal(isReferenceSelectionQuery({ __vclReferenceSelect: ["token"] }), false);
	assert.equal(isReferenceSelectionQuery({ __vclReferenceSelect: "token" }), true);
	assert.equal(
		referenceSelectionTokenFromQuery({ __vclReferenceSelect: "token" }),
		"token",
	);
});

test("defines cached scalar-key CRUD references", async () => {
	const { defineCrudReference } = await import("../src/utils/crudReference.ts");
	let detailCalls = 0;
	const reference = defineCrudReference<
		{ id: number; name: string },
		{ id: number },
		number
	>({
		list: async () => ({ rows: [], agg: { tot_count: 0 } }),
		detail: async ({ id }) => {
			detailCalls += 1;
			return { id, name: `Item ${id}` };
		},
		keyField: "id",
		searchField: "name",
		descrFields: ["name"],
	});

	const first = await reference.load(7);
	const second = await reference.load(7);

	assert.equal(detailCalls, 1);
	assert.equal(first?.descr, "Item 7");
	assert.equal(reference.valueFromReference(second), 7);
});

test("uses a column reference definition for reference search", async () => {
	const { buildSearchColumnOptions } = await import("../src/components/crudGrid/gridSearchUtils.ts");
	const { defineCrudReference } = await import("../src/utils/crudReference.ts");
	const reference = defineCrudReference<
		{ id: number; name: string },
		{ id: number },
		number
	>({
		list: async () => ({ rows: [], agg: { tot_count: 0 } }),
		detail: async ({ id }) => ({ id, name: String(id) }),
		keyField: "id",
		searchField: "name",
		descrFields: ["name"],
	});
	const [column] = buildSearchColumnOptions(
		[{
			field: "owner_id",
			headerKey: "owner",
			dataType: "reference",
			reference,
		}],
		(key) => key,
	);

	assert.equal(column?.referenceAutocomplete, reference.autocomplete);
});


test("wraps PrimeVue inline edit drafts in a stable reactive proxy", () => {
	const rawRow = {
		quant: 2,
		price: 10,
		amount: 20,
	};

	const first = getReactiveGridEditRow(rawRow);
	const second = getReactiveGridEditRow(rawRow);

	assert.equal(isReactive(first), true);
	assert.equal(isProxy(first), true);
	assert.equal(first, second);

	first.amount = 25;
	assert.equal(rawRow.amount, 25);
});

test("the common inline write path assigns the field before setValue", async () => {
	type Row = {
		quant: number;
		price: number;
		amount: number;
	};

	const rawRow: Row = {
		quant: 2,
		price: 10,
		amount: 20,
	};
	const editRow = getReactiveGridEditRow(rawRow);
	let renderedAmount = editRow.amount;
	const stop = watchEffect(() => {
		renderedAmount = editRow.amount;
	});
	let hookSawAssignedValue = false;
	let hookReceivedReactiveRow = false;

	const priceColumn: GridColumn<Row> = {
		field: "price",
		headerKey: "price",
		editable: true,
		dataType: "number",
		normalizeValue: (value) => Number(value ?? 0),
		setValue: (row) => {
			hookReceivedReactiveRow = isReactive(row) && isProxy(row);
			hookSawAssignedValue = row.price === 15;
			row.amount = row.quant * row.price;
		},
	};

	await applyGridInlineValue(rawRow, priceColumn, 15);
	await nextTick();

	assert.equal(hookReceivedReactiveRow, true);
	assert.equal(hookSawAssignedValue, true);
	assert.equal(rawRow.price, 15);
	assert.equal(rawRow.amount, 30);
	assert.equal(renderedAmount, 30);

	stop();
});

test("the common inline write path assigns fields without setValue", async () => {
	type Row = {
		line_num: number;
	};

	const rawRow: Row = {
		line_num: 1,
	};
	const column: GridColumn<Row> = {
		field: "line_num",
		headerKey: "line_num",
		editable: true,
		dataType: "number",
	};

	await applyGridInlineValue(rawRow, column, 8);

	assert.equal(rawRow.line_num, 8);
});

test("the common inline write path normalizes before assignment and setValue", async () => {
	type Row = {
		price: number;
		amount: number;
	};

	const rawRow: Row = {
		price: 5,
		amount: 10,
	};
	let hookValue: unknown;
	const column: GridColumn<Row> = {
		field: "price",
		headerKey: "price",
		editable: true,
		dataType: "number",
		normalizeValue: (value) => Math.round(Number(value ?? 0) * 100) / 100,
		setValue: (row, value) => {
			hookValue = value;
			assert.equal(row.price, 12.35);
		},
	};

	await applyGridInlineValue(rawRow, column, 12.345);

	assert.equal(rawRow.price, 12.35);
	assert.equal(hookValue, 12.35);
});

test("setValue can update dependent reference keys after common assignment", async () => {
	type Row = {
		material_id: number;
		measure_unit_id: number;
	};

	const rawRow: Row = {
		material_id: 0,
		measure_unit_id: 0,
	};
	const editRow = getReactiveGridEditRow(rawRow);
	let renderedMeasureUnit = editRow.measure_unit_id;
	const stop = watchEffect(() => {
		renderedMeasureUnit = editRow.measure_unit_id;
	});
	let hookSawMaterialId = false;

	const materialColumn: GridColumn<Row> = {
		field: "material_id",
		headerKey: "material",
		editable: true,
		dataType: "reference",
		setValue: async (row) => {
			await Promise.resolve();
			hookSawMaterialId = row.material_id === 42;
			row.measure_unit_id = 7;
		},
	};

	await applyGridInlineValue(rawRow, materialColumn, 42);
	await nextTick();

	assert.equal(hookSawMaterialId, true);
	assert.equal(rawRow.material_id, 42);
	assert.equal(rawRow.measure_unit_id, 7);
	assert.equal(renderedMeasureUnit, 7);

	stop();
});

test("CollectionGrid wires inline editors through the reactive draft contract", async () => {
	const source = await readFile(
		new URL("../src/components/crudGrid/CollectionGrid.vue", import.meta.url),
		"utf8",
	);

	assert.match(source, /:data="getReactiveGridEditRow\(data\)"/);
	assert.match(source, /:value="getReactiveGridEditRow\(data\)\[field\]"/);
	assert.match(
		source,
		/:updateValue="\(value(?::\s*(?:any|unknown))?\) => applyGridInlineValue\(data, column, value\)"/,
	);
	assert.match(source, /:modelValue="getReactiveGridEditRow\(data\)\[field\]"/);
	assert.match(
		source,
		/@update:modelValue="applyGridInlineValue\(data, column, \$event\)"/,
	);
});
