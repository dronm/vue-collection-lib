/** Opt-in keyset scrolling. Existing grids remain paginated when this is absent. */
export interface InfiniteScrollOptions<TModel extends object = Record<string, unknown>> {
	/** Unique server fields appended to the active sorting. Grids default to dataKey. */
	keyFields?: readonly string[];
	/** Rows retained from each request; the library requests one extra row. Default: 100. */
	chunkSize?: number;
	/** Start loading when this many cached rows remain after/before the viewport. Default: 30. */
	prefetchRows?: number;
	/** Maximum cached chunks, subject to the visible window. Zero retains all chunks. Default: 5. */
	maxCachedChunks?: number;
	/** Height of the scrolling viewport. Default: 32rem. */
	scrollHeight?: string;
	/** Fixed row height used by virtual rendering, in pixels. Default: 40. */
	itemSize?: number;
	/** Read exact server sorting values when list projections differ from server fields. */
	getCursorValue?: (row: TModel, field: string) => unknown;
}

export interface InfiniteCollectionChange {
	kind: "reset" | "append" | "prepend" | "refresh" | "remove";
	addedBefore: number;
	removedBefore: number;
}
