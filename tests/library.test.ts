import assert from "node:assert/strict";
import test from "node:test";

import { Conn } from "../src/api/Conn.ts";
import {
	buildCollectionQuery,
	createCrudApi,
	normalizeCollectionResponse,
} from "../src/api/createCrudApi.ts";
import { transformJSON } from "../src/api/transformJSON.ts";
import { useCollectionFormSubmit } from "../src/composables/form/useCollectionFormSubmit.ts";
import { useFormMutation } from "../src/composables/form/useFormMutation.ts";

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
