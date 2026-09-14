import assert from "node:assert/strict";
import test from "node:test";
import { defineCrudReference } from "../src/utils/crudReference.ts";

const fixture = () => {
	const calls: number[] = [];
	const reference = defineCrudReference<{ id: number; name: string }, { id: number }, number>({
		keyField: "id",
		searchField: "name",
		descrFields: ["name"],
		list: async () => ({ rows: [], agg: { tot_count: 0 } }),
		detail: async ({ id }) => {
			calls.push(id);
			return { id, name: `Loaded ${id}` };
		},
		isEmpty: (id) => id <= 0,
		emptyValue: 0,
	});
	return { reference, calls };
};

test("projected descriptions bypass detail and seed later ID-only renders", async () => {
	const { reference, calls } = fixture();
	const projected = { keys: { id: 7 }, descr: "Supplier", dataType: "suppliers" };
	assert.deepEqual(await reference.load(7, projected), projected);
	assert.deepEqual(await reference.load(7), projected);
	assert.deepEqual(calls, []);
});

test("clearing a reference ignores its old projection without loading", async () => {
	const { reference, calls } = fixture();
	const projected = { keys: { id: 7 }, descr: "Old site" };
	assert.equal(await reference.load(null, projected), null);
	assert.equal(await reference.load(0, projected), null);
	assert.deepEqual(calls, []);
});

test("changed IDs reject stale projections and preserve ID-only fallback", async () => {
	const { reference, calls } = fixture();
	const loaded = await reference.load(8, { keys: { id: 7 }, descr: "Old" });
	assert.equal(loaded?.descr, "Loaded 8");
	assert.deepEqual(calls, [8]);
	await reference.load(8);
	assert.deepEqual(calls, [8]);
});

test("new projections refresh cached descriptions including empty descriptions", async () => {
	const { reference, calls } = fixture();
	await reference.load(7);
	const projected = { keys: { id: 7 }, descr: "" };
	assert.deepEqual(await reference.load(7, projected), projected);
	assert.deepEqual(await reference.load(7), projected);
	assert.deepEqual(calls, [7]);
});

test("malformed projections cannot become cached reference values", async () => {
	const { reference, calls } = fixture();
	await reference.load(7, { keys: { id: 7 }, descr: null });
	assert.deepEqual(calls, [7]);
});
