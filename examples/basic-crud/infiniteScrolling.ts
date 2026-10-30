import {
	defineCollection,
	SortDirect,
	type CollectionGridApi,
} from "@katren/vue-collection-lib";

import { productApi } from "./api";
import type { Product, ProductKey, ProductNew, ProductUpd } from "./types";

/** The /products endpoint must first opt in to grouped backend filtering. */
export const infiniteProductCollection = defineCollection<Product, ProductKey, ProductNew, ProductUpd>({
	titleKey: "Product.title",
	api: productApi,
	dataKey: "id",
	getKey: (row) => ({ id: row.id }),
	columns: [
		{ field: "id", headerKey: "Product.fields.id", sortable: true, dataType: "number" },
		{ field: "name", headerKey: "Product.fields.name", sortable: true, dataType: "string" },
		{ field: "price", headerKey: "Product.fields.price", sortable: true, dataType: "number" },
	],
	defaultSorter: [{ f: "name", d: SortDirect.ASC }],
	infiniteScroll: {
		keyFields: ["id"],
		chunkSize: 100,
		prefetchRows: 30,
		maxCachedChunks: 5,
		scrollHeight: "32rem",
		itemSize: 40,
	},
});

export interface InfiniteOrderRow {
	id: number;
	/** Preserve the backend's date-only value without converting it to UTC. */
	order_date: string;
	customer_id: number;
}

export type InfiniteOrderKey = { id: number };

/** Supply the application's existing CRUD API; the grid computes cursor bounds. */
export const createInfiniteOrderCollection = (
	api: CollectionGridApi<InfiniteOrderRow, InfiniteOrderKey, unknown, Record<string, unknown>>,
) => defineCollection<InfiniteOrderRow, InfiniteOrderKey>({
	titleKey: "Order.title",
	api,
	dataKey: "id",
	getKey: (row) => ({ id: row.id }),
	columns: [
		{ field: "id", headerKey: "Order.fields.id", sortable: true, dataType: "number" },
		{ field: "order_date", headerKey: "Order.fields.order_date", sortable: true, dataType: "date" },
		{ field: "customer_id", headerKey: "Order.fields.customer_id", dataType: "number" },
	],
	baseParams: {
		filter: [{ j: "and", f: { customer_id: { o: "e", v: 10 } } }],
	},
	defaultSorter: [
		{ f: "order_date", d: SortDirect.DESC },
		{ f: "id", d: SortDirect.DESC },
	],
	infiniteScroll: {
		keyFields: ["id"],
		chunkSize: 100,
	},
});
