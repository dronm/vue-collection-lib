import assert from "node:assert/strict";
import test from "node:test";
import { ref, shallowRef } from "vue";

import { useInfiniteCollection } from "../src/composables/useInfiniteCollection";
import type { CollectionParams, CollectionResponse, CollectionWhere } from "../src/types/collection";
import type { InfiniteScrollOptions } from "../src/types/infiniteCollection";

interface Row {
	id: number;
	rank: number | null;
}

const matches = (row: Row, where: CollectionWhere | undefined): boolean => {
	if (!where) {
		return true;
	}
	if ("and" in where) {
		return where.and.every((item) => matches(row, item));
	}
	if ("or" in where) {
		return where.or.some((item) => matches(row, item));
	}
	const actual = row[where.f as keyof Row];
	if (where.o === "i") {
		return actual === null;
	}
	if (where.o === "in") {
		return actual !== null;
	}
	if (actual === null || where.v === null) {
		return false;
	}
	const value = where.v as number;
	switch (where.o) {
		case "e": return actual === value;
		case "g": return actual > value;
		case "l": return actual < value;
		case "ge": return actual >= value;
		case "le": return actual <= value;
		default: throw new Error(`Unexpected test operator: ${where.o}`);
	}
};

const fixture = (config: Partial<InfiniteScrollOptions<Row>> = {}) => {
	const source = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, rank: index + 1 }));
	const calls: CollectionParams[] = [];
	const rows = shallowRef<Row[]>([]);
	const agg = ref<Record<string, unknown>>({});
	const params = ref<CollectionParams>({ sorter: [{ f: "id", d: "d" }] });
	const enabled = ref(true);
	const query = (request: CollectionParams): CollectionResponse<Row> => {
		const matching = source.filter((row) => matches(row, request.where));
		matching.sort((left, right) => {
			for (const item of request.sorter ?? []) {
				const a = left[item.f as keyof Row];
				const b = right[item.f as keyof Row];
				const order = a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
				if (order !== 0) {
					return item.d === "a" ? order : -order;
				}
			}
			return 0;
		});
		return {
			rows: matching.slice(0, request.count).map((row) => ({ ...row })),
			agg: { tot_count: matching.length, sum: matching.reduce((total, row) => total + row.id, 0) },
		};
	};
	const api = {
		list: async (request?: CollectionParams): Promise<CollectionResponse<Row>> => {
			assert.ok(request);
			calls.push(structuredClone(request));
			return query(request);
		},
	};
	const options = shallowRef<InfiniteScrollOptions<Row> | undefined>({ keyFields: ["id"], chunkSize: 2, maxCachedChunks: 2, ...config });
	const loader = useInfiniteCollection({
		api,
		rows,
		agg,
		params,
		config: options,
		columns: ref([{ field: "id" as const, headerKey: "id" }]),
		getKey: (row: Row) => row.id,
		canEvict: () => enabled.value,
	});
	return { loader, rows, agg, params, api, calls, source, query, enabled, options };
};

const ids = (rows: Row[]): number[] => rows.map((row) => row.id);

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

test("keyset requests use lookahead, preserve search conditions and never advance offsets", async () => {
	const f = fixture({ maxCachedChunks: 0 });
	f.params.value.filter = [{ j: "and", f: { rank: { o: "g", v: 0 } } }];
	f.params.value.where = { f: "rank", o: "ge", v: 1 };
	await f.loader.load();
	assert.deepEqual(ids(f.rows.value), [12, 11]);
	assert.equal(f.loader.hasNext.value, true);
	assert.equal(f.loader.hasPrevious.value, false);
	assert.equal(f.calls[0]!.count, 3);
	assert.equal(f.calls[0]!.from, 0);
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9]);
	assert.deepEqual(f.calls[1]!.filter, f.params.value.filter);
	assert.ok(f.calls[1]!.where && "and" in f.calls[1]!.where);
	assert.equal(f.calls[1]!.from, 0);
	assert.equal(f.agg.value.tot_count, 12, "tail count must not replace collection totals");
	assert.equal(f.agg.value.sum, 78);
	for (let index = 0; index < 4; index += 1) {
		await f.loader.loadNext();
	}
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
	assert.equal(f.loader.hasNext.value, false);
	assert.equal(f.calls.length, 6);
	await f.loader.loadNext();
	assert.equal(f.calls.length, 6, "end-of-data must suppress further requests");
});

test("bounded chunks backfill in reverse query order without gaps or duplicates", async () => {
	const f = fixture();
	await f.loader.load();
	f.loader.setVisibleRange(1, 1);
	await f.loader.loadNext();
	f.loader.setVisibleRange(2, 3);
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [10, 9, 8, 7]);
	assert.equal(f.loader.change.value.removedBefore, 2);
	assert.equal(f.loader.hasPrevious.value, true);
	f.loader.setVisibleRange(0, 1);
	await f.loader.loadPrevious();
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9]);
	assert.deepEqual(f.calls.at(-1)!.sorter, [{ f: "id", d: "a" }]);
	assert.equal(f.loader.change.value.addedBefore, 2);
	assert.equal(f.loader.hasPrevious.value, false);
	assert.equal(f.loader.hasNext.value, true, "evicted tail remains reloadable");
});

test("eviction does not discard chunks intersecting the visible range", async () => {
	const f = fixture({ maxCachedChunks: 1 });
	await f.loader.load();
	f.loader.setVisibleRange(0, 2);
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9]);
	assert.equal(f.loader.hasPrevious.value, false);
});

test("same-edge calls share one request and failures retain a retryable boundary", async () => {
	const f = fixture();
	await f.loader.load();
	const pending = deferred<CollectionResponse<Row>>();
	const realList = f.api.list;
	let edgeCalls = 0;
	let request!: CollectionParams;
	f.api.list = async (params) => {
		edgeCalls += 1;
		request = params!;
		return pending.promise;
	};
	const first = f.loader.loadNext();
	const second = f.loader.loadNext();
	assert.equal(first, second);
	assert.equal(edgeCalls, 1);
	pending.reject(new Error("offline"));
	await assert.rejects(first, /offline/);
	assert.deepEqual(ids(f.rows.value), [12, 11]);
	assert.equal(f.loader.hasNext.value, true);
	assert.equal(f.loader.loadingNext.value, false);
	f.api.list = realList;
	await f.loader.loadNext();
	assert.deepEqual(f.calls.at(-1), request);
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9]);
	assert.equal(f.loader.error.value, null);
});

test("stale initial responses and errors cannot overwrite a newer query", async () => {
	const f = fixture();
	const old = deferred<CollectionResponse<Row>>();
	const realList = f.api.list;
	f.api.list = async () => old.promise;
	const first = f.loader.load();
	f.params.value = { sorter: [{ f: "id", d: "a" }], where: { f: "id", o: "g", v: 4 } };
	f.api.list = realList;
	await f.loader.load();
	assert.deepEqual(ids(f.rows.value), [5, 6]);
	old.reject(new Error("obsolete request failed"));
	await first;
	assert.deepEqual(ids(f.rows.value), [5, 6]);
	assert.equal(f.loader.error.value, null);
	assert.equal(f.loader.loadingInitial.value, false);
});

test("query mutation invalidates an in-flight edge even before a new load starts", async () => {
	const f = fixture();
	await f.loader.load();
	const pending = deferred<CollectionResponse<Row>>();
	f.api.list = async () => pending.promise;
	const edge = f.loader.loadNext();
	f.params.value.where = { f: "id", o: "l", v: 5 };
	pending.resolve({ rows: [{ id: 10, rank: 10 }, { id: 9, rank: 9 }, { id: 8, rank: 8 }], agg: { tot_count: 10 } });
	await edge;
	assert.deepEqual(ids(f.rows.value), [12, 11]);
	assert.equal(f.loader.loadingNext.value, false);
});

test("opposite requests serialize and recompute bounds after eviction", async () => {
	const f = fixture();
	await f.loader.load();
	f.loader.setVisibleRange(1, 1);
	await f.loader.loadNext();
	f.loader.setVisibleRange(2, 3);
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [10, 9, 8, 7]);
	f.loader.setVisibleRange(2, 3);
	const realList = f.api.list;
	const pending = deferred<CollectionResponse<Row>>();
	let pendingParams!: CollectionParams;
	let delayed = true;
	f.api.list = async (params) => {
		if (delayed) {
			delayed = false;
			pendingParams = params!;
			return pending.promise;
		}
		return realList(params);
	};
	const next = f.loader.loadNext();
	const previous = f.loader.loadPrevious();
	pending.resolve(f.query(pendingParams));
	await Promise.all([next, previous]);
	const result = ids(f.rows.value);
	assert.deepEqual(result, [10, 9, 8, 7]);
	assert.ok(result.every((value, index) => index === 0 || result[index - 1]! - value === 1));
	assert.equal(f.calls.at(-1)!.sorter![0]!.d, "a");
});

test("inline editing pauses requests and drops edge responses that arrive during editing", async () => {
	const f = fixture();
	await f.loader.load();
	f.enabled.value = false;
	await f.loader.loadNext();
	assert.equal(f.calls.length, 1);
	f.enabled.value = true;
	const realList = f.api.list;
	const pending = deferred<CollectionResponse<Row>>();
	let request!: CollectionParams;
	f.api.list = async (params) => {
		request = params!;
		return pending.promise;
	};
	const edge = f.loader.loadNext();
	f.enabled.value = false;
	f.rows.value[1]!.rank = 999;
	pending.resolve(f.query(request));
	await edge;
	assert.deepEqual(ids(f.rows.value), [12, 11]);
	assert.equal(f.rows.value[1]!.rank, 999);
	assert.equal(f.loader.hasNext.value, true);
	f.enabled.value = true;
	f.api.list = realList;
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [12, 11, 10, 9]);
});

test("cursor boundaries remain stable if a buffered row is mutated", async () => {
	const f = fixture();
	await f.loader.load();
	f.rows.value[1]!.id = 900;
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [12, 900, 10, 9]);
});

test("anchored refresh handles a deleted anchor without replacing full aggregates with tail totals", async () => {
	const f = fixture();
	await f.loader.load();
	await f.loader.loadNext();
	const anchor = f.rows.value[2]!;
	f.source.splice(f.source.findIndex((row) => row.id === anchor.id), 1);
	await f.loader.refresh(anchor);
	assert.deepEqual(ids(f.rows.value), [9, 8]);
	assert.equal(f.loader.change.value.kind, "refresh");
	assert.equal(f.loader.hasPrevious.value, true);
	assert.equal(f.agg.value.tot_count, 12);
	f.loader.setVisibleRange(0, 1);
	await f.loader.loadPrevious();
	assert.deepEqual(ids(f.rows.value), [12, 11, 9, 8]);
});

test("deleted rows cannot return from cache metadata or an already pending response", async () => {
	const f = fixture();
	await f.loader.load();
	const realList = f.api.list;
	const pending = deferred<CollectionResponse<Row>>();
	let request!: CollectionParams;
	f.api.list = async (params) => {
		request = params!;
		return pending.promise;
	};
	const edge = f.loader.loadNext();
	f.loader.removeRows([{ id: 12, rank: 12 }, { id: 10, rank: 10 }]);
	pending.resolve(f.query(request));
	await edge;
	assert.deepEqual(ids(f.rows.value), [11, 9]);
	f.api.list = realList;
	await f.loader.loadNext();
	assert.deepEqual(ids(f.rows.value), [11, 9, 8, 7]);
});

test("an endpoint ignoring cursor filters fails without repeatedly appending duplicates", async () => {
	const f = fixture();
	await f.loader.load();
	f.api.list = async () => ({ rows: [{ id: 12, rank: 12 }, { id: 11, rank: 11 }, { id: 10, rank: 10 }], agg: { tot_count: 12 } });
	await assert.rejects(f.loader.loadNext(), /cursor did not advance/);
	assert.deepEqual(ids(f.rows.value), [12, 11]);
	assert.equal(f.loader.loadingNext.value, false);
});

test("disposal suppresses pending responses and configuration failures are explicit", async () => {
	const f = fixture();
	const pending = deferred<CollectionResponse<Row>>();
	f.api.list = async () => pending.promise;
	const load = f.loader.load();
	f.loader.dispose();
	pending.resolve({ rows: [{ id: 1, rank: 1 }], agg: { tot_count: 1 } });
	await load;
	assert.deepEqual(f.rows.value, []);
	assert.equal(f.loader.loadingInitial.value, false);
	const invalid = fixture({ chunkSize: 0 });
	await assert.rejects(invalid.loader.load(), /chunkSize/);
	assert.match(invalid.loader.error.value!, /chunkSize/);
	for (const options of [{ itemSize: 0 }, { itemSize: Number.NaN }, { scrollHeight: " " }]) {
		const invalidViewport = fixture(options);
		await assert.rejects(invalidViewport.loader.load(), /itemSize|scrollHeight/);
	}
});
