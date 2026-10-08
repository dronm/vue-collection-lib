import * as v from "valibot";

import {
	createCrudApi,
	defineCollection,
	defineCrudReference,
	type GridColumn,
} from "@katren/vue-collection-lib";

import { http } from "./api";
import type { CategoryKey, CategoryRow } from "./types";

type CategoryNew = Omit<CategoryRow, "id">;
type CategoryUpd = Partial<CategoryNew>;

export const categoryApi = createCrudApi<
	CategoryRow,
	CategoryRow,
	CategoryRow,
	CategoryRow,
	CategoryKey,
	CategoryNew,
	CategoryUpd
>({
	api: http,
	basePath: "/categories",
	serviceName: "Category",
	getKeyValue: (key) => key.id,
	fromListDTO: (dto) => dto,
	fromDetailDTO: (dto) => dto,
});

export const categoryCollection = defineCollection<
	CategoryRow,
	CategoryKey,
	CategoryNew,
	CategoryUpd
>({
	titleKey: "Category.title",
	api: categoryApi,
	dataKey: "id",
	getKey: (row) => ({ id: row.id }),
	editMode: "inline",
	columns: [
		{
			field: "id",
			headerKey: "Category.fields.id",
			dataType: "number",
		},
		{
			field: "name",
			headerKey: "Category.fields.name",
			sortable: true,
			editable: true,
			dataType: "string",
		},
	],
	createRow: () => ({ id: 0, name: "" }),
	createModel: (row) => ({ name: row.name.trim() }),
	createSchema: v.object({
		name: v.pipe(v.string(), v.minLength(1, "Name is required")),
	}),
});

// Use this reference when the catalogue can be created from its column metadata.
export const categoryDialogReference = defineCrudReference<CategoryRow, CategoryKey>({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
	openRoute: (value) => ({
		name: "CategoryEdit",
		params: { id: value.keys?.id as number },
	}),
	selectRoute: { name: "CategoryList" },
	create: {
		mode: "dialog",
		collection: () => categoryCollection,
		title: "Create category",
	},
});

// Use this alternative when CategoryCreate provides a standalone creation form.
// A form using useCollectionEditPage returns the saved category automatically.
export const categoryPageReference = defineCrudReference<CategoryRow, CategoryKey>({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
	selectRoute: { name: "CategoryList" },
	create: {
		mode: "page",
		route: { name: "CategoryCreate" },
		target: "_blank",
	},
});

interface ProductInlineRow {
	id: number;
	name: string;
	category_id: number | null;
}

// The same definition also works with ReferenceKeyInput in a standalone form.
export const productInlineColumns: GridColumn<ProductInlineRow>[] = [
	{
		field: "name",
		headerKey: "Product.fields.name",
		editable: true,
		dataType: "string",
	},
	{
		field: "category_id",
		headerKey: "Product.fields.category",
		editable: true,
		dataType: "reference",
		reference: categoryDialogReference,
	},
];
