<script setup lang="ts">
import {
	CollectionGrid,
	SortDirect,
	referenceAutocompleteEq,
	type GridColumn,
	type GridRouteConfig,
} from "@katren/vue-collection-lib";

import { categoryList, productApi } from "./api";
import type {
	CategoryKey,
	CategoryRow,
	Product,
	ProductKey,
} from "./types";

const categoryAutocomplete = referenceAutocompleteEq<CategoryRow, CategoryKey>({
	searchField: "name",
	keyFields: ["id"],
	descrFields: ["name"],
	list: categoryList,
	completeOnFocus: true,
	minLength: 0,
});

const columns: GridColumn<Product>[] = [
	{
		field: "id",
		headerKey: "Product.fields.id",
		header: "ID",
		sortable: true,
		dataType: "number",
		width: "7rem",
	},
	{
		field: "name",
		headerKey: "Product.fields.name",
		header: "Name",
		sortable: true,
		dataType: "string",
	},
	{
		field: "category_ref",
		headerKey: "Product.fields.category",
		header: "Category",
		dataType: "reference",
		searchReferenceAutocomplete: categoryAutocomplete,
		searchReferenceKeys: {
			id: "category_id",
		},
		format: (value) => {
			return typeof value === "object" && value !== null && "descr" in value
				? String(value.descr)
				: "";
		},
	},
	{
		field: "price",
		headerKey: "Product.fields.price",
		header: "Price",
		sortable: true,
		dataType: "number",
		align: "right",
		format: (value) => Number(value).toFixed(2),
	},
	{
		field: "active",
		headerKey: "Product.fields.active",
		header: "Active",
		dataType: "boolean",
		format: (value) => value ? "Yes" : "No",
	},
];

const routes: GridRouteConfig<Product> = {
	create: {
		name: "ProductCreate",
	},
	edit: (row) => ({
		name: "ProductEdit",
		params: {
			id: row.id,
		},
	}),
	copy: (row) => ({
		name: "ProductCopy",
		params: {
			id: row.id,
		},
	}),
};

const getKey = (row: Product): ProductKey => {
	return {
		id: row.id,
	};
};
</script>

<template>
	<CollectionGrid
		:api="productApi"
		:columns="columns"
		dataKey="id"
		:getKey="getKey"
		:routes="routes"
		:defaultSorter="[
			{
				f: 'name',
				d: SortDirect.ASC,
			},
		]"
		stateKey="products"
		editMode="page"
	/>
</template>
