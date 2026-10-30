import assert from "node:assert/strict";
import test from "node:test";

import type { GridColumn } from "../src/components/crudGrid/types.ts";
import {
	SortDirect,
	type CollectionSorter,
	type CollectionWhere,
} from "../src/types/collection.ts";
import {
	collectionCursorWhere,
	snapshotCollectionCursor,
	stableCollectionSorter,
} from "../src/utils/collectionCursor.ts";

type Value = string | number | boolean | null;
type OracleRow = Record<string, Value>;

// This comparator defines display order independently from the generated
// expression: PostgreSQL ASC puts nulls last, whereas DESC puts them first.
const compareRows = (left: OracleRow, right: OracleRow, sorter: CollectionSorter[]): number => {
	for (const { f, d } of sorter) {
		const a = left[f];
		const b = right[f];
		if (a === b) {
			continue;
		}
		const factor = d === SortDirect.ASC ? 1 : -1;
		if (a === null) {
			return factor;
		}
		if (b === null) {
			return -factor;
		}
		return (a! < b! ? -1 : 1) * factor;
	}
	return 0;
};

// Model SQL WHERE truth for the operators used by cursors, including comparisons
// with NULL evaluating to UNKNOWN (and therefore failing the WHERE clause).
const matches = (row: OracleRow, expression: CollectionWhere | null): boolean => {
	if (expression === null) {
		return false;
	}
	if ("and" in expression) {
		return expression.and.every((child) => matches(row, child));
	}
	if ("or" in expression) {
		return expression.or.some((child) => matches(row, child));
	}
	const actual = row[expression.f];
	const expected = expression.v as Value;
	if (expression.o === "i") {
		return actual === null;
	}
	if (expression.o === "in") {
		return actual !== null;
	}
	if (actual === null || expected === null) {
		return false;
	}
	switch (expression.o) {
		case "e": return actual === expected;
		case "l": return actual! < expected;
		case "g": return actual! > expected;
		default: throw new Error(`Unexpected cursor operator ${expression.o}`);
	}
};

test("stable sorting appends unique composite keys without mutating requested sorters", () => {
	const requested = [{ f: "date", d: SortDirect.ASC }];
	assert.deepEqual(stableCollectionSorter(requested, ["tenant_id", "id"]), [
		{ f: "date", d: SortDirect.ASC },
		{ f: "tenant_id", d: SortDirect.ASC },
		{ f: "id", d: SortDirect.ASC },
	]);
	assert.deepEqual(requested, [{ f: "date", d: SortDirect.ASC }]);
	assert.deepEqual(stableCollectionSorter(undefined, ["id"]), [
		{ f: "id", d: SortDirect.DESC },
	]);
	assert.deepEqual(stableCollectionSorter([
		{ f: "name", d: SortDirect.ASC },
		{ f: "id", d: SortDirect.DESC },
		{ f: "name", d: SortDirect.DESC },
	], ["id", "id"]), [
		{ f: "name", d: SortDirect.ASC },
		{ f: "id", d: SortDirect.DESC },
	]);
	assert.throws(() => stableCollectionSorter([], []), /unique key/);
	assert.throws(() => stableCollectionSorter([], [" "]), /field names/);
});

test("every mixed-direction cursor agrees with sorted dataset slices, including duplicate sort values and nulls", () => {
	const dataset: OracleRow[] = [];
	for (const score of [-1, 0, 2, null]) {
		for (const label of ["", "x", null]) {
			for (let duplicate = 0; duplicate < 2; duplicate += 1) {
				dataset.push({ id: dataset.length + 1, score, label });
			}
		}
	}

	for (const scoreDirection of [SortDirect.ASC, SortDirect.DESC]) {
		for (const labelDirection of [SortDirect.ASC, SortDirect.DESC]) {
			for (const idDirection of [SortDirect.ASC, SortDirect.DESC]) {
				const sorter = [
					{ f: "score", d: scoreDirection },
					{ f: "label", d: labelDirection },
					{ f: "id", d: idDirection },
				];
				const ordered = [...dataset].sort((left, right) => compareRows(left, right, sorter));
				for (let index = 0; index < ordered.length; index += 1) {
					const cursor = snapshotCollectionCursor(ordered[index]!, sorter, []);
					for (const direction of ["before", "after"] as const) {
						for (const inclusive of [false, true]) {
							const expression = collectionCursorWhere(sorter, cursor, direction, inclusive);
							const actual = ordered.filter((row) => matches(row, expression)).map((row) => row.id);
							const expected = direction === "before"
								? ordered.slice(0, index + Number(inclusive)).map((row) => row.id)
								: ordered.slice(index + Number(!inclusive)).map((row) => row.id);
							assert.deepEqual(actual, expected,
								`${scoreDirection}/${labelDirection}/${idDirection}: ${direction} anchor ${index}, inclusive=${inclusive}`);
						}
					}
				}
			}
		}
	}
});

test("a null-only single-field boundary reports impossible ranges and uses explicit null predicates", () => {
	const ascending = [{ f: "value", d: SortDirect.ASC }];
	const descending = [{ f: "value", d: SortDirect.DESC }];
	const cursor = { values: [null] };
	assert.equal(collectionCursorWhere(ascending, cursor, "after"), null);
	assert.equal(collectionCursorWhere(descending, cursor, "before"), null);
	assert.deepEqual(collectionCursorWhere(ascending, cursor, "before"), { f: "value", o: "in", v: null });
	assert.deepEqual(collectionCursorWhere(descending, cursor, "after"), { f: "value", o: "in", v: null });
	assert.deepEqual(collectionCursorWhere(ascending, cursor, "after", true), { f: "value", o: "i", v: null });
});

test("cursor snapshots preserve local calendar dates, instants, and immutable boundaries", () => {
	type Row = { day: Date; timestamp: Date; id: number };
	const day = new Date(2026, 9, 29, 23, 17, 42);
	const timestamp = new Date("2026-10-29T15:17:42.123Z");
	const row: Row = { day, timestamp, id: 42 };
	const columns: GridColumn<Row>[] = [
		{ field: "day", headerKey: "day", dataType: "date" },
		{ field: "timestamp", headerKey: "timestamp", dataType: "datetime" },
	];
	const sorter = stableCollectionSorter([
		{ f: "day", d: SortDirect.DESC },
		{ f: "timestamp", d: SortDirect.DESC },
	], ["id"]);
	const cursor = snapshotCollectionCursor(row, sorter, columns);
	assert.deepEqual(cursor.values, ["2026-10-29", "2026-10-29T15:17:42.123Z", 42]);
	day.setFullYear(1990);
	timestamp.setTime(0);
	row.id = 99;
	assert.deepEqual(cursor.values, ["2026-10-29", "2026-10-29T15:17:42.123Z", 42]);
	assert.ok(Object.isFrozen(cursor));
	assert.ok(Object.isFrozen(cursor.values));
});

test("cursor values resolve sort aliases, dotted fields, and custom precision-preserving mappings", () => {
	type Row = { display_name: string; nested: { amount: string }; id: string; raw: string };
	const row: Row = {
		display_name: "alpha",
		nested: { amount: "12345678901234567890.123456789" },
		id: "900719925474099312345",
		raw: "2026-10-29T15:17:42.123456Z",
	};
	const aliasColumns: GridColumn<Row>[] = [
		{ field: "display_name", sortField: "name", headerKey: "name" },
	];
	assert.deepEqual(snapshotCollectionCursor(row, [
		{ f: "name", d: SortDirect.ASC },
		{ f: "nested.amount", d: SortDirect.ASC },
		{ f: "id", d: SortDirect.ASC },
	], aliasColumns).values, ["alpha", "12345678901234567890.123456789", "900719925474099312345"]);
	assert.deepEqual(snapshotCollectionCursor(row, [
		{ f: "timestamp", d: SortDirect.ASC },
	], [], (item, field) => field === "timestamp" ? item.raw : undefined).values,
	["2026-10-29T15:17:42.123456Z"]);
});

test("invalid or absent sorting values fail explicitly instead of issuing a weaker cursor", () => {
	const sorter = [{ f: "value", d: SortDirect.ASC }];
	for (const value of [undefined, {}, [], Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, new Date("invalid")]) {
		assert.throws(() => snapshotCollectionCursor({ value }, sorter, []), /cursor value|date cursor/);
	}
	assert.throws(() => snapshotCollectionCursor({}, sorter, []), /sorting field "value"/);
	assert.throws(() => collectionCursorWhere(sorter, { values: [] }, "after"), /must match/);
	assert.throws(() => collectionCursorWhere(sorter, { values: [undefined] }, "after"), /Missing cursor value/);
	assert.throws(() => collectionCursorWhere([], { values: [] }, "after"), /non-empty/);
	assert.deepEqual(snapshotCollectionCursor({ value: true }, sorter, []).values, [true]);
	assert.deepEqual(snapshotCollectionCursor({ value: 1.25 }, sorter, []).values, [1.25]);
});
