import { computed, ref, shallowRef, type Ref, type ShallowRef } from "vue";

import type { GridColumn } from "../components/crudGrid/types";
import { SortDirect, type CollectionParams, type CollectionResponse, type CollectionWhere } from "../types/collection";
import type { InfiniteCollectionChange, InfiniteScrollOptions } from "../types/infiniteCollection";
import {
	collectionCursorWhere,
	snapshotCollectionCursor,
	stableCollectionSorter,
	type CollectionCursor,
} from "../utils/collectionCursor";
import { errorText } from "../utils/errorText";

export interface UseInfiniteCollectionOptions<TModel extends object, TKey> {
	api: { list: (params?: CollectionParams) => Promise<CollectionResponse<TModel> | void> };
	rows: ShallowRef<TModel[]>;
	agg: Ref<Record<string, unknown>>;
	params: Ref<CollectionParams>;
	config: Ref<InfiniteScrollOptions<TModel> | undefined>;
	columns: Ref<GridColumn<TModel>[]>;
	getKey: (row: TModel) => TKey;
	/** Pause fetching/trimming while an inline editor owns a draft in this window. */
	canEvict?: () => boolean;
}

interface CachedChunk<TModel> {
	rows: TModel[];
	first: CollectionCursor;
	last: CollectionCursor;
}

interface PendingRequest {
	signature: string;
	promise: Promise<void>;
}

const copyParams = (params: CollectionParams): CollectionParams => {
	// Capture the wire values, independent of later reactive filter mutations.
	return JSON.parse(JSON.stringify(params)) as CollectionParams;
};

const combineWhere = (base: CollectionWhere | undefined, boundary: CollectionWhere): CollectionWhere => {
	return base ? { and: [base, boundary] } : boundary;
};

/** A bounded, bidirectional keyset cache. DOM/keyboard behavior belongs to the grid. */
export const useInfiniteCollection = <TModel extends object, TKey>(
	options: UseInfiniteCollectionOptions<TModel, TKey>,
) => {
	const loadingInitial = ref(false);
	const loadingNext = ref(false);
	const loadingPrevious = ref(false);
	const error = ref<string | null>(null);
	const hasNext = ref(false);
	const hasPrevious = ref(false);
	const revision = ref(0);
	const change = shallowRef<InfiniteCollectionChange>({ kind: "reset", addedBefore: 0, removedBefore: 0 });
	const sorter = computed(() => stableCollectionSorter(options.params.value.sorter, options.config.value?.keyFields ?? []));
	let chunks: CachedChunk<TModel>[] = [];
	let visibleFirst = 0;
	let visibleLast = 0;
	let generation = 0;
	let disposed = false;
	let loadedSignature: string | null = null;
	let initialRequest: PendingRequest | null = null;
	let nextRequest: PendingRequest | null = null;
	let previousRequest: PendingRequest | null = null;
	let removedKeys = new Set<string>();

	const configuration = () => {
		const config = options.config.value;
		if (!config) {
			throw new Error("Infinite scrolling is not enabled.");
		}
		const chunkSize = config.chunkSize ?? 100;
		const prefetchRows = config.prefetchRows ?? 30;
		const maxCachedChunks = config.maxCachedChunks ?? 5;
		if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize >= Number.MAX_SAFE_INTEGER) {
			throw new Error("infiniteScroll.chunkSize must be a positive safe integer.");
		}
		if (!Number.isSafeInteger(prefetchRows) || prefetchRows < 0) {
			throw new Error("infiniteScroll.prefetchRows must be a non-negative safe integer.");
		}
		if (!Number.isSafeInteger(maxCachedChunks) || maxCachedChunks < 0) {
			throw new Error("infiniteScroll.maxCachedChunks must be a non-negative safe integer (zero means unlimited).");
		}
		if (config.itemSize !== undefined && (!Number.isFinite(config.itemSize) || config.itemSize <= 0)) {
			throw new Error("infiniteScroll.itemSize must be a positive finite number.");
		}
		if (config.scrollHeight !== undefined && (typeof config.scrollHeight !== "string" || config.scrollHeight.trim() === "")) {
			throw new Error("infiniteScroll.scrollHeight must be a non-empty CSS height.");
		}
		return { ...config, chunkSize, prefetchRows, maxCachedChunks };
	};

	const signature = (): string => {
		const config = configuration();
		return JSON.stringify({
			params: options.params.value,
			sorter: sorter.value,
			chunkSize: config.chunkSize,
			keyFields: config.keyFields,
		});
	};

	const snapshot = (row: TModel): CollectionCursor => {
		return snapshotCollectionCursor(row, sorter.value, options.columns.value, options.config.value?.getCursorValue);
	};

	const rowKey = (row: TModel): string => {
		const key = options.getKey(row);
		const text = JSON.stringify(key);
		if (key === null || key === undefined || text === undefined) {
			throw new Error("Infinite scrolling requires a stable, non-null key for every server row.");
		}
		return text;
	};

	const uniqueRows = (rows: TModel[], existing: readonly TModel[] = []): TModel[] => {
		const keys = new Set([...existing.map(rowKey), ...removedKeys]);
		return rows.filter((row) => {
			const key = rowKey(row);
			if (keys.has(key)) {
				return false;
			}
			keys.add(key);
			return true;
		});
	};

	const chunk = (rows: TModel[], boundaryRows: TModel[] = rows): CachedChunk<TModel> => {
		return {
			rows,
			first: snapshot(boundaryRows[0]!),
			last: snapshot(boundaryRows.at(-1)!),
		};
	};

	const current = (epoch: number, expectedSignature: string): boolean => {
		try {
			return !disposed && epoch === generation && expectedSignature === signature() && options.canEvict?.() !== false;
		} catch {
			return false;
		}
	};

	const requestParams = (boundary?: CollectionWhere, before = false): CollectionParams => {
		const config = configuration();
		const base = copyParams(options.params.value);
		return {
			...base,
			from: 0,
			count: config.chunkSize + 1,
			sorter: sorter.value.map((item) => ({
				...item,
				d: before ? item.d === SortDirect.ASC ? SortDirect.DESC : SortDirect.ASC : item.d,
			})),
			...(boundary ? { where: combineWhere(base.where, boundary) } : {}),
		};
	};

	const publish = (kind: InfiniteCollectionChange["kind"], addedBefore = 0, removedBefore = 0): void => {
		// Change metadata is set before rows so synchronous anchor watchers can use it.
		change.value = { kind, addedBefore, removedBefore };
		options.rows.value = chunks.flatMap((item) => item.rows);
		revision.value += 1;
	};

	const trim = (direction: "after" | "before"): number => {
		const maximum = configuration().maxCachedChunks;
		if (maximum === 0 || options.canEvict?.() === false) {
			return 0;
		}
		let removedBefore = 0;
		while (chunks.length > maximum && chunks.length > 1) {
			if (direction === "after") {
				const count = chunks[0]!.rows.length;
				if (visibleFirst < count) {
					break;
				}
				chunks.shift();
				visibleFirst = Math.max(0, visibleFirst - count);
				visibleLast = Math.max(0, visibleLast - count);
				removedBefore += count;
				hasPrevious.value = true;
			} else {
				const countBeforeLast = chunks.slice(0, -1).reduce((total, item) => total + item.rows.length, 0);
				if (visibleLast >= countBeforeLast) {
					break;
				}
				chunks.pop();
				hasNext.value = true;
			}
		}
		return removedBefore;
	};

	const start = (anchor?: TModel): Promise<void> => {
		if (disposed) {
			return Promise.resolve();
		}
		let querySignature: string;
		let anchorCursor: CollectionCursor | undefined;
		try {
			querySignature = signature();
			anchorCursor = anchor && querySignature === loadedSignature ? snapshot(anchor) : undefined;
		} catch (err: unknown) {
			error.value = errorText(err);
			return Promise.reject(err);
		}
		const requestSignature = `${querySignature}:${anchorCursor ? JSON.stringify(anchorCursor) : "start"}`;
		if (initialRequest?.signature === requestSignature) {
			return initialRequest.promise;
		}
		const epoch = ++generation;
		removedKeys = new Set();
		loadingInitial.value = true;
		loadingNext.value = false;
		loadingPrevious.value = false;
		error.value = null;
		nextRequest = null;
		previousRequest = null;
		const pending: PendingRequest = { signature: requestSignature, promise: Promise.resolve() };
		initialRequest = pending;
		pending.promise = (async () => {
			try {
				const size = configuration().chunkSize;
				const boundary = anchorCursor ? collectionCursorWhere(sorter.value, anchorCursor, "after", true) : undefined;
				let response = await options.api.list(requestParams(boundary ?? undefined));
				if (!current(epoch, querySignature)) {
					return;
				}
				if (!response) {
					throw new Error("Infinite collection loading expected a rows response.");
				}
				let reverse = false;
				if (anchorCursor && response.rows.length === 0) {
					const preceding = collectionCursorWhere(sorter.value, anchorCursor, "before");
					if (preceding) {
						response = await options.api.list(requestParams(preceding, true));
						if (!current(epoch, querySignature)) {
							return;
						}
						if (!response) {
							throw new Error("Infinite collection loading expected a rows response.");
						}
						reverse = true;
					}
				}
				const raw = response.rows.slice(0, size);
				if (reverse) {
					raw.reverse();
				}
				const rows = uniqueRows(raw);
				const nextChunks = rows.length > 0 ? [chunk(rows, raw)] : [];
				chunks = nextChunks;
				loadedSignature = querySignature;
				visibleFirst = 0;
				visibleLast = 0;
				hasPrevious.value = reverse ? response.rows.length > size : Boolean(anchorCursor && rows.length > 0);
				hasNext.value = reverse ? false : response.rows.length > size;
				if (!anchorCursor) {
					options.agg.value = { ...response.agg };
				}
				publish(anchorCursor ? "refresh" : "reset");
			} catch (err: unknown) {
				if (current(epoch, querySignature)) {
					error.value = errorText(err);
					throw err;
				}
			} finally {
				if (initialRequest === pending) {
					loadingInitial.value = false;
					initialRequest = null;
				}
			}
		})();
		return pending.promise;
	};

	const load = (): Promise<void> => start();
	const refresh = (anchor?: TModel): Promise<void> => {
		return start(anchor ?? options.rows.value[visibleFirst]);
	};

	const loadEdge = (direction: "after" | "before"): Promise<void> => {
		if (disposed || loadingInitial.value || options.canEvict?.() === false) {
			return Promise.resolve();
		}
		const pending = direction === "after" ? nextRequest : previousRequest;
		if (pending) {
			return pending.promise;
		}
		const opposite = direction === "after" ? previousRequest : nextRequest;
		if (opposite) {
			// Re-read the edge after the other request may have trimmed its boundary.
			const epoch = generation;
			return opposite.promise.then(() => epoch === generation && !disposed ? loadEdge(direction) : undefined);
		}
		let querySignature: string;
		try {
			querySignature = signature();
		} catch (err: unknown) {
			error.value = errorText(err);
			return Promise.reject(err);
		}
		if (querySignature !== loadedSignature) {
			return load();
		}
		const availability = direction === "after" ? hasNext : hasPrevious;
		if (!availability.value || chunks.length === 0) {
			return Promise.resolve();
		}
		const cursor = direction === "after" ? chunks.at(-1)!.last : chunks[0]!.first;
		const boundary = collectionCursorWhere(sorter.value, cursor, direction);
		if (!boundary) {
			availability.value = false;
			return Promise.resolve();
		}
		const epoch = generation;
		const busy = direction === "after" ? loadingNext : loadingPrevious;
		busy.value = true;
		error.value = null;
		const request: PendingRequest = { signature: querySignature, promise: Promise.resolve() };
		if (direction === "after") {
			nextRequest = request;
		} else {
			previousRequest = request;
		}
		request.promise = (async () => {
			try {
				const size = configuration().chunkSize;
				const response = await options.api.list(requestParams(boundary, direction === "before"));
				if (!current(epoch, querySignature)) {
					return;
				}
				if (!response) {
					throw new Error("Infinite collection loading expected a rows response.");
				}
				const raw = response.rows.slice(0, size);
				if (direction === "before") {
					raw.reverse();
				}
				const rows = uniqueRows(raw, options.rows.value);
				if (raw.length > 0 && rows.length === 0) {
					throw new Error("Infinite collection cursor did not advance. Check that the endpoint accepts grouped where conditions and the sorting key is unique.");
				}
				const nextChunk = rows.length > 0 ? chunk(rows, raw) : undefined;
				availability.value = response.rows.length > size;
				if (!nextChunk) {
					return;
				}
				let addedBefore = 0;
				if (direction === "after") {
					chunks.push(nextChunk);
				} else {
					chunks.unshift(nextChunk);
					addedBefore = rows.length;
					visibleFirst += addedBefore;
					visibleLast += addedBefore;
				}
				const removedBefore = trim(direction);
				publish(direction === "after" ? "append" : "prepend", addedBefore, removedBefore);
			} catch (err: unknown) {
				if (current(epoch, querySignature)) {
					error.value = errorText(err);
					throw err;
				}
			} finally {
				if (direction === "after" ? nextRequest === request : previousRequest === request) {
					busy.value = false;
					if (direction === "after") {
						nextRequest = null;
					} else {
						previousRequest = null;
					}
				}
			}
		})();
		return request.promise;
	};

	const loadNext = (): Promise<void> => loadEdge("after");
	const loadPrevious = (): Promise<void> => loadEdge("before");
	const setVisibleRange = (first: number, last: number): void => {
		visibleFirst = Math.max(0, Math.floor(Number.isFinite(first) ? first : 0));
		visibleLast = Math.max(visibleFirst, Math.floor(Number.isFinite(last) ? last : visibleFirst));
	};
	const removeRows = (rows: TModel[]): void => {
		const keys = new Set(rows.map(rowKey));
		keys.forEach((key) => removedKeys.add(key));
		const before = options.rows.value.slice(0, visibleFirst).filter((row) => keys.has(rowKey(row))).length;
		chunks = chunks.map((item) => ({ ...item, rows: item.rows.filter((row) => !keys.has(rowKey(row))) }));
		visibleFirst = Math.max(0, visibleFirst - before);
		visibleLast = Math.max(visibleFirst, visibleLast - before);
		publish("remove", 0, before);
	};
	const dispose = (): void => {
		disposed = true;
		generation += 1;
		initialRequest = null;
		nextRequest = null;
		previousRequest = null;
		loadingInitial.value = false;
		loadingNext.value = false;
		loadingPrevious.value = false;
	};

	return {
		loadingInitial,
		loadingNext,
		loadingPrevious,
		error,
		hasNext,
		hasPrevious,
		revision,
		change,
		sorter,
		load,
		refresh,
		loadNext,
		loadPrevious,
		setVisibleRange,
		removeRows,
		dispose,
	};
};
