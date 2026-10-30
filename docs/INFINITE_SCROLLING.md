# Infinite collection scrolling

`CollectionGrid` and `CollectionListPage` can load records as the user scrolls,
using the same collection columns, slots, commands, editors, events, routes, and
CRUD API. Pagination remains the default when `infiniteScroll` is omitted.

## Enable the backend first

Infinite mode sends grouped cursor conditions in `CollectionParams.where` to
the existing list endpoint. With the updated Go libraries, opt that endpoint in
using all three changes:

1. Use `webapp.CollectionParamsWithWhereBinder()` on the route.
2. Accept `modelbind.CollectionParamsWithWhere` in the service method.
3. Fetch through `webapp.FetchCollectionModelWhere` or
   `webapp.FetchCollectionModelWhereWithConn`.

For custom SQL services, use `pg.NewPgGroupedSelect` and
`modelbind.BindCollectionSelectModelWithWhere`, then build through the grouped
wrapper. Keep the existing `{ rows, agg }` response envelope.

Updating Go dependencies alone is insufficient. Legacy collection binders ignore
the new `where` property, so their endpoints cannot apply cursor boundaries.
Both old paginated requests and new grouped requests work on an opted-in endpoint.

## Switch an existing collection

Add one optional property to an existing definition:

```ts
const scrollingCollection = defineCollection({
	...existingCollection,
	infiniteScroll: {
		keyFields: ["id"],
		chunkSize: 100,
	},
});
```

Use that definition with `CollectionListPage` as before. When using
`CollectionGrid` directly, pass the same options through its `infiniteScroll`
prop. Remove the property to return to pagination; no separate grid component or
list API method is needed.

See [infiniteScrolling.ts](../examples/basic-crud/infiniteScrolling.ts) for typed
product and date-and-ID order definitions.

| Option | Default | Purpose |
| --- | --- | --- |
| `keyFields` | `[dataKey]` in the grid | Backend field names forming a unique final ordering key. Specify every component for composite keys. |
| `chunkSize` | `100` | Number of records retained from each request. |
| `prefetchRows` | `30` | Begin loading the adjacent chunk when the viewport approaches an edge. |
| `maxCachedChunks` | `5` | Target number of chunks held around the viewport; `0` retains all loaded chunks. |
| `scrollHeight` | `"32rem"` | Height of the scrolling table viewport. |
| `itemSize` | `40` | Fixed row height in pixels for virtual rendering. |
| `getCursorValue` | Automatic field/column lookup | Return the backend sorting value for a row and backend field name. |

`pageSize` and persisted page offsets continue to control paginated mode; infinite
mode uses its own chunk size and starts with `from: 0`.

## Cursor requests and sorting

Every chunk is requested through the existing `api.list(params)` method with:

- The collection's existing filters and active search conditions.
- The effective server sorting, including fixed/base sorters.
- Missing unique `keyFields` appended as sorting tie-breakers.
- `from: 0` and `count: chunkSize + 1`.
- A grouped `where` boundary after the initial request.

The extra row determines whether another chunk exists; it is not discarded from
the dataset, because the next cursor is taken from the last retained row. Chunk
loading does not use increasing offsets or rely on `agg.tot_count`.

For `order_date DESC, id DESC`, a boundary after date `2026-10-29` and ID `1500`
is logically:

```sql
order_date < '2026-10-29'
OR (order_date = '2026-10-29' AND id < 1500)
```

It is sent as ordinary grouped JSON:

```json
{
	"or": [
		{ "f": "order_date", "o": "l", "v": "2026-10-29" },
		{
			"and": [
				{ "f": "order_date", "o": "e", "v": "2026-10-29" },
				{ "f": "id", "o": "l", "v": 1500 }
			]
		}
	]
}
```

If `baseParams.where` already supplies a grouped condition, it is combined with
the cursor using AND. Existing legacy `filter` conditions remain separate, and
the backend combines their complete expression with the grouped expression.

Ascending, descending, and mixed sorting are supported. A unique key is necessary
even when users sort by a non-unique name or date. Each sorting value must be
available from the returned row or `getCursorValue`. The final ordering key must
actually be unique for the endpoint's result set.

Null comparisons follow PostgreSQL's default sorting: ascending places nulls last
and descending places them first. Cursor conditions use explicit `IS NULL` and
`IS NOT NULL` tests where needed. A backend using a different null ordering must
not silently apply that ordering to these requests.

## Cursor values and dates

The default lookup uses the sorting field or its matching column's model field.
Provide `getCursorValue(row, field)` when a DTO projection, reference object, or
derived display value differs from the server sorting value. Return the actual
backend value; a translated label or rounded display value is not a valid cursor.

Date objects in columns with `dataType: "date"` become local calendar dates in
`YYYY-MM-DD` form. Other Date values become ISO timestamps. Strings are preserved
unchanged. Keep timestamps as exact strings when database precision exceeds
JavaScript Date precision, and preserve large numeric identifiers as strings when
they exceed JavaScript's safe integer range. Cursor values must match the values
used by the backend's ORDER BY.

## Buffer, navigation, and editing

The viewport prefetches nearby records before reaching the loaded edge. Arrow-key
navigation uses the same buffer and can wait for the next or previous chunk at
an edge. A failed adjacent request leaves existing rows available and offers a
retry.

The grid virtualizes the retained records, so only a small part of the buffer is
rendered. Design custom cells to fit the fixed `itemSize`; wrapped or expanding
content that changes row height is unsuitable for this virtual layout.

With a cache limit, distant chunks can be removed and loaded again when scrolling
back. Visible rows are protected during eviction, and the visible anchor is
preserved when records are inserted or removed above it. The cache limit is a
target: protecting the viewport can temporarily require more retained rows.
Inline editing pauses adjacent loading and eviction so an active draft is not
removed while it is being edited.

Selection is tracked by record identity. Marked records retain loaded snapshots
for batch commands even if their chunk leaves the main cache. These snapshots
can become stale if another user edits the same record. Ctrl+A marks the cached
records, not every matching record on the server; range marking also applies to
available cached records.

Changing sorting, search, base parameters, or the current hierarchy folder resets
the buffer to the beginning. Refreshing the current view reloads around its visible
anchor rather than returning to the first chunk where possible. Cursor scrolling
does not provide a database snapshot: concurrent changes to sorting values can
move records across chunk boundaries.

The scrollbar describes the retained window. This mode does not provide arbitrary
page jumps or an exact scrollbar position across all unloaded records.

## Totals and footers

The initial request has no cursor boundary, so its aggregates describe the full
filtered collection before limiting. Those aggregates are retained while loading
adjacent chunks and during anchored refreshes. A tail request's aggregate would
describe only records beyond its boundary, so it must not replace the collection
total.

Consequently, retained aggregate totals can become stale after changes to the
dataset. An explicit grid `load()` resets the buffer and recomputes them from a
new initial request. A footer `calc(rows, agg)` receives the current retained
window as `rows`; it must not treat those rows as the entire server collection.
