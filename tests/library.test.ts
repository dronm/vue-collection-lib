import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isProxy, isReactive, nextTick, watchEffect } from "vue";

import { APIError, Conn } from "../src/api/Conn.ts";
import {
	buildCollectionQuery,
	CollectionRowValidationError,
	createCrudApi,
	normalizeCollectionResponse,
} from "../src/api/createCrudApi.ts";
import * as v from "valibot";
import { transformJSON } from "../src/api/transformJSON.ts";
import {
	cloneGridRow,
	formatGridValue,
	gridDatePickerProps,
	isGridDateDataType,
	makeChangedModel,
	makeCreateModel,
} from "../src/components/crudGrid/gridUtils.ts";
import {
	buildSearchFilters,
	formatSearchValue,
	searchOperationsForType,
} from "../src/components/crudGrid/gridSearchUtils.ts";
import { deleteRowsSequentially } from "../src/components/crudGrid/deleteRows.ts";
import {
	applyGridInlineValue,
	getReactiveGridEditRow,
} from "../src/components/crudGrid/inlineEditing.ts";
import type { GridColumn } from "../src/components/crudGrid/types.ts";
import { useCollectionFormSubmit } from "../src/composables/form/useCollectionFormSubmit.ts";
import { useFormMutation } from "../src/composables/form/useFormMutation.ts";
import { errorText } from "../src/utils/errorText.ts";
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

test("keeps the public API message for a restricted delete", () => {
	const message = "Невозможно удалить запись: она используется в других данных.";
	const error = new APIError("request error", 409, {
		error: {
			code: "record_in_use",
			message,
		},
	});

	assert.equal(errorText(error), message);
});

test("deletes every requested key sequentially", async () => {
	const deletedKeys: number[] = [];
	const result = await deleteRowsSequentially([11, 12, 13], async (key) => {
		deletedKeys.push(key);
	});

	assert.deepEqual(deletedKeys, [11, 12, 13]);
	assert.deepEqual(result, {
		succeeded: true,
		deletedCount: 3,
	});
});

test("stops a delete batch and reports its partial progress", async () => {
	const deletedKeys: number[] = [];
	const failure = new Error("record is in use");
	const result = await deleteRowsSequentially([21, 22, 23], async (key) => {
		deletedKeys.push(key);
		if (key === 22) {
			throw failure;
		}
	});

	assert.deepEqual(deletedKeys, [21, 22]);
	assert.equal(result.succeeded, false);
	assert.equal(result.deletedCount, 1);
	if (!result.succeeded) {
		assert.equal(result.error, failure);

		const remainingKeys = [21, 22, 23].slice(result.deletedCount);
		const retriedKeys: number[] = [];
		await deleteRowsSequentially(remainingKeys, async (key) => {
			retriedKeys.push(key);
		});

		assert.deepEqual(retriedKeys, [22, 23]);
	}
});

test("keeps the complete batch pending when its first delete fails", async () => {
	const attemptedKeys: number[] = [];
	const result = await deleteRowsSequentially([31, 32], async (key) => {
		attemptedKeys.push(key);
		throw new Error("delete failed");
	});

	assert.deepEqual(attemptedKeys, [31]);
	assert.equal(result.succeeded, false);
	assert.equal(result.deletedCount, 0);
	assert.deepEqual([31, 32].slice(result.deletedCount), [31, 32]);
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

test("serializes Date and null request values as JSON rather than display strings", async () => {
	const originalFetch = globalThis.fetch;
	let requestBody: BodyInit | null | undefined;
	const selected = new Date("2026-09-18T09:35:00.000Z");

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
		await conn.post("/dates", {
			starts_at: selected,
			completed_at: null,
		});

		assert.deepEqual(
			JSON.parse(String(requestBody)),
			{
				starts_at: selected.toISOString(),
				completed_at: null,
			},
		);
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

test("configures date and datetime DatePicker editors without allowing string models", () => {
	assert.equal(isGridDateDataType("date"), true);
	assert.equal(isGridDateDataType("datetime"), true);
	assert.equal(isGridDateDataType("string"), false);

	assert.deepEqual(
		gridDatePickerProps("date", {
			showClear: false,
			showTime: true,
			selectionMode: "range",
			updateModelType: "string",
		}),
		{
			showIcon: true,
			showClear: false,
			showTime: false,
			selectionMode: "single",
			updateModelType: "date",
		},
	);

	assert.deepEqual(
		gridDatePickerProps("datetime", {
			hourFormat: "12",
			showIcon: false,
		}),
		{
			showIcon: false,
			showClear: true,
			hourFormat: "12",
			showTime: true,
			selectionMode: "single",
			updateModelType: "date",
		},
	);
});

test("inline date edit preserves a Date value", async () => {
	type Row = {
		for_date: Date | null;
	};

	const row: Row = {
		for_date: null,
	};
	const column: GridColumn<Row> = {
		field: "for_date",
		headerKey: "for_date",
		editable: true,
		dataType: "date",
	};
	const selected = new Date(2026, 8, 18);

	await applyGridInlineValue(row, column, selected);

	assert.equal(row.for_date, selected);
	assert.ok(row.for_date instanceof Date);
});

test("inline datetime edit preserves the selected date and time", async () => {
	type Row = {
		created_at: Date | null;
	};

	const row: Row = {
		created_at: null,
	};
	const column: GridColumn<Row> = {
		field: "created_at",
		headerKey: "created_at",
		editable: true,
		dataType: "datetime",
	};
	const selected = new Date(2026, 8, 18, 14, 35, 42);

	await applyGridInlineValue(row, column, selected);

	assert.equal(row.created_at, selected);
	assert.equal(row.created_at.getHours(), 14);
	assert.equal(row.created_at.getMinutes(), 35);
});

test("inline date clearing stores null", async () => {
	type Row = {
		some_date: Date | null;
	};

	const row: Row = {
		some_date: new Date(2026, 8, 18),
	};
	const column: GridColumn<Row> = {
		field: "some_date",
		headerKey: "some_date",
		editable: true,
		dataType: "date",
	};

	await applyGridInlineValue(row, column, null);

	assert.equal(row.some_date, null);
});

test("inline create payload preserves Date and null values", () => {
	type Row = {
		id: number;
		for_date: Date | null;
		completed_at: Date | null;
	};
	type New = Pick<Row, "for_date" | "completed_at">;

	const forDate = new Date(2026, 8, 20);
	const model = makeCreateModel<Row, New>(
		{
			id: 0,
			for_date: forDate,
			completed_at: null,
		},
		[
			{
				field: "for_date",
				headerKey: "for_date",
				editable: true,
				dataType: "date",
			},
			{
				field: "completed_at",
				headerKey: "completed_at",
				editable: true,
				dataType: "datetime",
			},
		],
	);

	assert.equal(model.for_date, forDate);
	assert.ok(model.for_date instanceof Date);
	assert.equal(model.completed_at, null);
});

test("inline update sends changed dates and nullable clears", () => {
	type Row = {
		for_date: Date;
		completed_at: Date | null;
	};
	type Update = Partial<Row>;

	const originalDate = new Date(2026, 8, 18);
	const originalCompletedAt = new Date(2026, 8, 18, 12, 0);
	const changedDate = new Date(2026, 8, 19);
	const columns: GridColumn<Row>[] = [
		{
			field: "for_date",
			headerKey: "for_date",
			editable: true,
			dataType: "date",
		},
		{
			field: "completed_at",
			headerKey: "completed_at",
			editable: true,
			dataType: "datetime",
		},
	];

	const model = makeChangedModel<Row, Update>(
		{
			for_date: originalDate,
			completed_at: originalCompletedAt,
		},
		{
			for_date: changedDate,
			completed_at: null,
		},
		columns,
	);

	assert.equal(model.for_date, changedDate);
	assert.ok(model.for_date instanceof Date);
	assert.equal(model.completed_at, null);

	assert.deepEqual(
		makeChangedModel<Row, Update>(
			{
				for_date: originalDate,
				completed_at: null,
			},
			{
				for_date: new Date(originalDate),
				completed_at: null,
			},
			columns,
		),
		{},
	);
});

test("cloned inline drafts keep date cancellation isolated", () => {
	const original = {
		for_date: new Date(2026, 8, 18),
		created_at: new Date(2026, 8, 18, 9, 30),
	};
	const draft = cloneGridRow(original);

	assert.notEqual(draft.for_date, original.for_date);
	assert.notEqual(draft.created_at, original.created_at);

	draft.for_date.setDate(25);
	draft.created_at.setHours(16);

	assert.equal(original.for_date.getDate(), 18);
	assert.equal(original.created_at.getHours(), 9);
});

test("formats date and datetime columns with their standard display conventions", () => {
	type Row = {
		for_date: Date | null;
		created_at: Date | null;
	};

	const value = new Date(2026, 8, 18, 14, 35);
	const row: Row = {
		for_date: value,
		created_at: value,
	};

	assert.equal(
		formatGridValue(row, {
			field: "for_date",
			headerKey: "for_date",
			dataType: "date",
		}),
		value.toLocaleDateString(),
	);
	assert.equal(
		formatGridValue(row, {
			field: "created_at",
			headerKey: "created_at",
			dataType: "datetime",
		}),
		value.toLocaleString(),
	);
	assert.equal(
		formatGridValue(row, {
			field: "for_date",
			headerKey: "for_date",
			dataType: "date",
			format: () => "custom",
		}),
		"custom",
	);
	assert.equal(
		formatGridValue(
			{
				for_date: null,
				created_at: null,
			},
			{
				field: "for_date",
				headerKey: "for_date",
				dataType: "date",
			},
		),
		"",
	);
});

test("datetime search uses DatePicker-compatible instants instead of text filters", () => {
	const value = new Date("2026-09-18T09:35:00.000Z");
	const column = {
		field: "created_at",
		header: "Created at",
		searchField: "created_at",
		dataType: "datetime" as const,
		operations: searchOperationsForType("datetime"),
	};

	assert.deepEqual(column.operations, ["exact", "range"]);
	assert.deepEqual(
		buildSearchFilters(column, "exact", value),
		[{
			j: "and",
			f: {
				created_at: {
					o: "e",
					v: value.toISOString(),
				},
			},
		}],
	);
	assert.equal(formatSearchValue(value, "datetime"), value.toLocaleString());
	assert.equal(formatSearchValue(value, "date"), value.toLocaleDateString());
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

test("CollectionGrid uses DatePicker for built-in date and datetime editors", async () => {
	const source = await readFile(
		new URL("../src/components/crudGrid/CollectionGrid.vue", import.meta.url),
		"utf8",
	);

	assert.match(source, /import DatePicker from "primevue\/datepicker"/);
	assert.match(source, /<DatePicker\s+[\s\S]*?v-else-if="isGridDateDataType\(column\.dataType\)"/);
	assert.match(
		source,
		/v-bind="gridDatePickerProps\(column\.dataType, column\.editorProps\)"/,
	);
	assert.match(source, /:modelValue="getReactiveGridEditRow\(data\)\[field\]"/);
	assert.match(
		source,
		/@update:modelValue="applyGridInlineValue\(data, column, \$event\)"/,
	);
});

test("CollectionGrid renders delete failures and preserves retryable rows", async () => {
	const source = await readFile(
		new URL("../src/components/crudGrid/CollectionGrid.vue", import.meta.url),
		"utf8",
	);

	assert.match(source, /const deleteError = ref<string \| null>\(null\)/);
	assert.match(source, /deletePendingRows\.value = rows\.slice\(result\.deletedCount\)/);
	assert.match(source, /v-if="deleteError"/);
	assert.match(source, /class="crud-grid-error crud-grid-delete-error"/);
	assert.match(source, /role="alert"/);
});
