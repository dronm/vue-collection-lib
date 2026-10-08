# @katren/vue-collection-lib

Reusable Vue 3 and PrimeVue building blocks for data-oriented web applications.

The package provides a server-driven CRUD grid, reference/autocomplete input, form mutation and validation helpers, an HTTP client, WebSocket subscriptions, and English/Russian locale messages.

## Features

- PrimeVue `DataTable` CRUD grid with lazy pagination and server sorting;
- optional server-driven hierarchical collections with group navigation, breadcrumbs, and flat/global-search mode;
- built-in create, edit, copy, delete, search, and refresh commands;
- keyboard shortcuts, row marking, cell cursor, context menu, and persisted grid state;
- string, number, boolean, enum, date, datetime, range, and reference search criteria;
- inline, modal, page, and tab edit modes;
- built-in inline Select editors for enum fields;
- built-in inline DatePicker editors for date and datetime fields;
- automatic collection reload after WebSocket CRUD events;
- reference autocomplete with open, collection-picker select, optional create-new, and clear actions;
- create/update payload generation with changed fields only;
- reference-to-key payload mapping;
- Valibot validation and normalized API/field errors;
- collection schema errors include the failing row, row identity, and nested field path;
- dirty-form route guard;
- typed HTTP and CRUD API helpers;
- English and Russian translations.

The components include their own layout CSS. Tailwind CSS is not required.

## Requirements

The host application must provide these peer dependencies:

- Vue 3.5+;
- PrimeVue 4;
- PrimeIcons 7;
- Vue Router 4.5+ or 5;
- Vue I18n 11;
- Valibot 1.

The package publishes Vue SFC and TypeScript source files. It is intended for Vite and Nuxt applications, which process `.vue` and `.ts` dependencies. A different bundler must be configured to compile these files from `node_modules`.

## Installation

```bash
npm install @katren/vue-collection-lib primevue primeicons vue-router vue-i18n valibot
```

For PrimeVue styled mode, install a theme preset or configure your own theme:

```bash
npm install @primeuix/themes
```

## Application setup

### Vite / Vue

```ts
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";

import Aura from "@primeuix/themes/aura";
import PrimeVue from "primevue/config";
import "primeicons/primeicons.css";

import {
	collectionLibEn,
	collectionLibRu,
} from "@katren/vue-collection-lib/locales";

import App from "./App.vue";

const i18n = createI18n({
	legacy: false,
	locale: "en",
	fallbackLocale: "en",
	messages: {
		en: {
			...collectionLibEn,
		},
		ru: {
			...collectionLibRu,
		},
	},
});

const router = createRouter({
	history: createWebHistory(),
	routes: [],
});

createApp(App)
	.use(PrimeVue, {
		theme: {
			preset: Aura,
		},
	})
	.use(i18n)
	.use(router)
	.mount("#app");
```

When the application already has an initialized I18n instance, messages can be merged after creation:

```ts
import { installCollectionLibMessages } from "@katren/vue-collection-lib";

installCollectionLibMessages(i18n);
```

Most UI components call `useI18n()` and `useRouter()`, so install both plugins before mounting the application.

### PrimeVue date locale

`DatePicker` uses the host application's PrimeVue locale. Configure it globally rather than per grid column. Install `primelocale` when using its locale bundles:

```bash
npm install primelocale
```

```ts
import { ru } from "primelocale/js/ru.js";

app.use(PrimeVue, {
	locale: {
		...ru,
		dateFormat: "dd.mm.yy",
		firstDayOfWeek: 1,
	},
});
```

PrimeVue date formatting is not Go or PostgreSQL formatting. In PrimeVue, `dd.mm.yy` produces a four-digit year.

## CRUD API

The `createCrudApi()` helper adapts a REST endpoint to the grid and form contracts.

```ts
import {
	Conn,
	createCrudApi,
} from "@katren/vue-collection-lib";

interface ProductDTO {
	id: number;
	name: string;
	price: number | string;
	updated_at: string;
}

interface Product {
	id: number;
	name: string;
	price: number;
	updated_at: Date;
}

type ProductKey = {
	id: number;
};

type ProductNew = Omit<Product, "id" | "updated_at">;
type ProductUpd = Partial<ProductNew>;

const http = new Conn("/api", 30_000);

const fromDTO = (dto: ProductDTO): Product => ({
	...dto,
	price: Number(dto.price),
	updated_at: new Date(dto.updated_at),
});

export const productApi = createCrudApi<
	Product,
	ProductDTO,
	Product,
	ProductDTO,
	ProductKey,
	ProductNew,
	ProductUpd
>({
	api: http,
	basePath: "/products",
	serviceName: "Product",
	getKeyValue: (key) => key.id,
	fromListDTO: fromDTO,
	fromDetailDTO: fromDTO,
});
```

### Composite route keys

Use `getKeyPath()` when the endpoint has multiple path parameters. Each segment is encoded separately.

```ts
const api = createCrudApi({
	api: http,
	basePath: "/group-items",
	getKeyPath: (key: { groupId: number; itemId: number }) => [
		key.groupId,
		key.itemId,
	],
	fromListDTO: (dto) => dto,
	fromDetailDTO: (dto) => dto,
});
```

This generates `/group-items/57/66`, not `/group-items/57%2F66`.

### Expected backend contract

Collection requests use:

```text
GET /products?params={JSON-encoded CollectionParams}
```

The expected response is:

```json
{
	"rows": [],
	"agg": {
		"tot_count": 0
	}
}
```

For compatibility, `normalizeCollectionResponse()` also accepts `total` or `count` and normalizes it to `agg.tot_count`.

The remaining default routes are:

```text
GET    /products/{key}
POST   /products
PATCH  /products/{key}
DELETE /products/{key}
```

## CollectionGrid

Row and cell pointer selection keeps the current document scroll position while focusing the grid for keyboard shortcuts. This avoids the Chromium/Edge/mobile Chrome jump that can otherwise move a different row under the second click of a double-click.

When inline row editing is active, collection-level keyboard routing is suspended. Keyboard events from editor controls are also left to those controls, so typing in an input or reference autocomplete cannot open the collection search dialog or trigger grid shortcuts.

Pressing `Enter` on the grid activates the current row exactly like a double-click. Normally this runs the edit action. A collection opened from a `ReferenceInput` select action is automatically switched into selection mode instead: it shows a picker banner, suppresses mutating commands, and returns the selected row to the originating reference input on `Enter` or double-click.

### Hierarchical collections

Set `hierarchy` on `CollectionGrid` or `CollectionDefinition` to enable folder-style navigation. The zero-configuration data contract uses these fields:

```ts
interface ProductRow {
	id: number;
	name: string;
	parent_id: number | null;
	is_group: boolean;
}
```

```ts
const productCollection = defineCollection({
	titleKey: "Product.title",
	api: productApi,
	columns,
	dataKey: "id",
	getKey: (row: ProductRow) => ({ id: row.id }),
	hierarchy: {},
});
```

Hierarchy mode adds `parent_id IS NULL` at the root and `parent_id = currentGroupId` after entering a group. These are base filters, not search criteria, so they are not shown as removable search chips. User search filters are merged after the hierarchy filter.

Groups are placed first by default by adding a fixed `is_group DESC` sorter before the user's sorters. Set `groupsFirst: false` to disable this behavior.

The command panel receives a hierarchy/flat icon switch. In flat mode the hierarchy filter is removed, breadcrumbs are hidden, and searching covers all groups and elements. Switching back restores the previously selected group path. The view mode and breadcrumb path are persisted per `stateKey` in session storage.

Group rows use a folder icon, element rows use a file icon, and the current breadcrumb uses an open-folder icon. Double-click/Enter on a group, or a click on its folder icon, enters that group. The explicit Edit command still edits the group itself. In flat mode groups are normal, non-navigable rows.

The defaults can be overridden when a model uses other field names or presentation rules:

```ts
hierarchy: {
	parentField: "parent_id",
	groupField: "is_group",
	idField: "id",
	labelField: "name",
	defaultViewMode: "hierarchy",
	allowFlatView: true,
	groupsFirst: true,
	groupIcon: "pi pi-folder",
	openGroupIcon: "pi pi-folder-open",
	flatGroupIcon: "pi pi-folder",
	itemIcon: "pi pi-file",
	groupRowClass: "product-group-row",
},
```

The default group typography can be changed through inherited CSS variables:

```css
.products-grid {
	--crud-grid-group-font-size: 1.1em;
	--crud-grid-group-font-weight: 700;
}
```

Hierarchical inline creation initializes and always submits `parent_id` and `is_group`, even when those fields are not editable columns. The standard Create command creates an element; Create group creates a group. In flat mode new records are created at the root because there is no visible current group.

For page/tab edit mode, make the create route a factory when the form needs the structural values:

```ts
const routes: GridRouteConfig<ProductRow> = {
	create: (context) => ({
		name: "ProductCreate",
		query: {
			parent_id: context.initialValues?.parent_id as number | null,
			is_group: context.initialValues?.is_group ? "1" : "0",
		},
	}),
};
```

Reference pickers default to selecting elements only. Set `selectable: "groups"`, `selectable: "all"`, or provide a predicate for other cases. In hierarchy mode a group still opens on Enter/double-click; use the explicit Select button when the reference itself accepts groups.

```vue
<script setup lang="ts">
import {
	CollectionGrid,
	SortDirect,
	type GridColumn,
	type GridRouteConfig,
} from "@katren/vue-collection-lib";

import { productApi } from "@/api/product";
import type {
	Product,
	ProductKey,
} from "@/types/product";

const columns: GridColumn<Product>[] = [
	{
		field: "name",
		headerKey: "Product.fields.name",
		sortable: true,
		dataType: "string",
	},
	{
		field: "price",
		headerKey: "Product.fields.price",
		sortable: true,
		dataType: "number",
		align: "right",
		format: (value) => Number(value).toFixed(2),
	},
	{
		field: "active",
		headerKey: "Product.fields.active",
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
```

### Commands

`commandsMode` controls how custom commands are combined with built-ins:

- `default`: built-in commands only;
- `append`: built-ins plus custom commands, with matching names overriding defaults;
- `replace`: only the supplied commands. Built-in names still inherit their default icon, label, shortcut, and enabled rule.

```ts
import type { GridCommand } from "@katren/vue-collection-lib";

const commands: GridCommand<Product, ProductKey>[] = [
	{
		name: "create",
	},
	{
		name: "edit",
	},
	{
		name: "exportSelected",
		label: "Export selected",
		icon: "pi pi-download",
		shortcut: "Ctrl+E",
		enabled: (row) => row !== null,
		handler: async ({ rows }) => {
			await exportProducts(rows);
		},
	},
];
```

```vue
<CollectionGrid
	:commands="commands"
	commandsMode="append"
/>
```

Context-menu commands use the same model. Set `:showContextMenu="false"` to disable the context menu.

Automatic delete failures are formatted with `errorText()`. With confirmation enabled,
the message is shown in the delete dialog and the failed row can be retried or cancelled.
If a multi-row delete stops after partially succeeding, the grid is reloaded and Retry
continues with only the failed and not-yet-attempted rows. Without confirmation, the
same error is shown in the grid error panel.

### Search

Search behavior is configured per column. Text fields support begins, contains, and exact matching. Enum fields support exact matching with their raw option value. Number, date, and datetime fields support exact and range matching. Reference columns map reference keys to backend filter fields.

```ts
const columns: GridColumn<Product>[] = [
	{
		field: "category_ref",
		headerKey: "Product.fields.category",
		dataType: "reference",
		searchReferenceAutocomplete: categoryAutocomplete,
		searchReferenceKeys: {
			id: "category_id",
		},
	},
];
```

Applied criteria appear below the command panel and are persisted when `stateKey` is set.

### Enum columns

Use `dataType: "enum"` to share one option definition between cell display, inline editing, and exact search. The built-in editor and search control use PrimeVue `Select`; their models remain the raw string or number values.

```ts
import type {
	GridColumn,
	GridEnumOption,
} from "@katren/vue-collection-lib";

interface MaterialStatusRow {
	id: number;
	status: "at_work" | "on_maintenance";
}

const materialStatusOptions = [
	{
		value: "at_work",
		labelKey: "MaterialStatusType.at_work",
	},
	{
		value: "on_maintenance",
		labelKey: "MaterialStatusType.on_maintenance",
	},
] as const satisfies readonly GridEnumOption[];

const columns: GridColumn<MaterialStatusRow>[] = [
	{
		field: "status",
		headerKey: "MaterialStatus.fields.status",
		sortable: true,
		editable: true,
		dataType: "enum",
		enumOptions: materialStatusOptions,
		editorProps: {
			showClear: false,
		},
	},
];
```

For display, `label` takes precedence over a translated `labelKey`, followed by the raw value as a fallback. `disabled` is forwarded to both Select controls. Clearing is not enabled automatically; opt into it with `editorProps.showClear`. A custom `format`, editor slot, search component, or search value hook continues to override the built-in behavior.

### Date and datetime inline editors

Use `dataType: "date"` for a calendar date and `dataType: "datetime"` for a value that includes a time. Both use PrimeVue `DatePicker` automatically, so ordinary temporal columns do not need custom editor slots:

```ts
interface OrderRow {
	id: number;
	for_date: Date | null;
	delivery_at: Date | null;
}

const columns: GridColumn<OrderRow>[] = [
	{
		field: "for_date",
		headerKey: "Order.fields.for_date",
		editable: true,
		dataType: "date",
	},
	{
		field: "delivery_at",
		headerKey: "Order.fields.delivery_at",
		editable: true,
		dataType: "datetime",
		editorProps: {
			stepMinute: 5,
			showButtonBar: true,
		},
	},
];

const createRow = (): OrderRow => ({
	id: 0,
	for_date: null,
	delivery_at: null,
});
```

The editor model is always one `Date` or `null`. Date fields hide the time controls; datetime fields show 24-hour time controls. The clear button is enabled by default, and `editorProps` forwards other DatePicker options such as `minDate`, `maxDate`, `stepMinute`, `showSeconds`, and `showButtonBar`. The grid protects `selectionMode`, `updateModelType`, and date-versus-datetime `showTime`, so options cannot accidentally change the model to an array or formatted string.

Rows passed to `CollectionGrid` should already contain `Date | null`, not API strings. Convert DTO strings in `fromListDTO` and `fromDetailDTO`. `createCrudApi()` keeps model conversion explicit; `Conn` serializes outbound `Date` values as ISO strings. If a date-only endpoint requires `YYYY-MM-DD` rather than an ISO timestamp, map that field in `beforeCreate` and `beforeUpdate`.

Use `datetime` for both timestamp and timestamptz fields at the grid layer. Their DatePicker behavior is identical; timezone and wire-format semantics belong in DTO conversion. Without a custom `format`, date cells use `toLocaleDateString()` and datetime cells use `toLocaleString()`. PrimeVue input formatting still comes from the application-level locale configuration described above.

### Slots

Body, editor, and footer slots are named from the field:

```vue
<CollectionGrid ...>
	<template #body-price="{ value }">
		<strong>{{ Number(value).toFixed(2) }}</strong>
	</template>

	<template #editor-name="{ data, field }">
		<InputText v-model="data[field]" />
	</template>

	<template #footer-price="{ agg }">
		{{ agg.price_total }}
	</template>
</CollectionGrid>
```

## Declarative references and lightweight forms

For forms that store a scalar foreign key, keep the key as the model source of truth instead of maintaining a parallel `*_ref` field. `defineCrudReference()` packages autocomplete, detail lookup, caching, fallback display, and open/select routes, while `ReferenceKeyInput` and `ReferenceKeyLabel` convert between the scalar key and `ReferenceValue` internally.

```ts
export const categoryReference = defineCrudReference({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
});
```

```vue
<ReferenceKeyInput
	v-model="form.category_id"
	:reference="categoryReference"
/>
```

`CollectionForm`, `FormField`, `CollectionEditPage`, `useCollectionFormModel()`, and `useCollectionEditPage()` provide the repeated form/page lifecycle without replacing Vue templates with a metadata layout language. `defineCollection()` plus `CollectionListPage` provides the equivalent lightweight wrapper for ordinary lists.

For document detail grids, `useChildCollection()` owns the parent filter, next line number, temporary negative keys, and inline create plumbing. Reference columns can be declared with `dataType: "reference"` plus a reference definition; built-in numeric editors accept `editorProps`, and `setValue` keeps domain calculations in application code.

Inline editor drafts are always exposed as reactive rows. Every built-in editor writes through `applyGridInlineValue()`, which applies optional `normalizeValue`, assigns the edited field, and then invokes `setValue`. A `setValue` callback therefore normally contains only dependent-field logic (for example `quant × price → amount` or `material → measure unit`). Custom `editor-*` slots receive the same reactive row through `data` and the same write function through `updateValue(value)`.

### Creating a referenced element

Add `create` to a reference definition to enable its Create new button. Omitting `create` keeps the button hidden. The same definition works in standalone forms and inline grid editors.

For a simple catalogue, reuse its existing collection definition:

```ts
export const categoryReference = defineCrudReference({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
	create: {
		mode: "dialog",
		collection: () => categoryCollection,
		prefill: (text) => ({ name: text.trim() }),
	},
});
```

The generated dialog uses the collection's editable columns, `createRow`, `createModel`, and `api.create`. It loads the saved detail before returning the selected reference. `createSchema` and `validateCreate` on the collection provide optional validation. Fields with `createEditable: false` are omitted; `createEditable: true` includes a field that is read-only during updates.

For a custom creation page, use:

```ts
create: {
	mode: "page",
	route: { name: "CategoryCreate" },
	target: "_blank",
	prefill: (text) => ({ name: text.trim() }),
},
```

Optional `prefill` maps unfinished text typed into the reference input to editable creation defaults. It receives the raw text; blank input and an existing selected label keep the usual defaults. These values apply once, so user corrections remain editable. Page defaults must be JSON-compatible and are passed separately from the route URL.

Pages built with `useCollectionEditPage()` return the created detail automatically when opened through this action. The same page opened normally keeps its usual redirect behavior. Custom form handlers can use `useReferenceCreation()` to complete or cancel the return flow.

Creation updates the originating reference through its normal model and dependent-field hooks. A parent form or grid row remains unsaved; cancelling that parent later does not delete the independently created catalogue element. To restrict creation in the UI, use `:showCreate="canCreate"` on `ReferenceKeyInput`, or set `create.disabled`. The backend must enforce its own permissions.

See [reference creation documentation](src/components/reference/README.md#creating-a-referenced-element) for setup, customization, and custom-page completion. A typechecked API, collection, and reference example is in `examples/basic-crud/referenceCreation.ts`.

## ReferenceInput

A reference value has keys and a human-readable description:

```ts
{
	keys: {
		id: 123,
	},
	descr: "Category A",
}
```

```vue
<script setup lang="ts">
import {
	ReferenceInput,
	referenceAutocompleteEq,
} from "@katren/vue-collection-lib";

import { categoryApi } from "@/api/category";

const categoryAutocomplete = referenceAutocompleteEq({
	searchField: "name",
	keyFields: ["id"],
	descrFields: ["name"],
	list: categoryApi.list,
	completeOnFocus: true,
	minLength: 0,
});
</script>

<template>
	<ReferenceInput
		v-model="form.category_ref"
		:autocomplete="categoryAutocomplete"
		:openAction="form.category_ref?.keys ? {
			route: {
				name: 'CategoryEdit',
				params: form.category_ref.keys,
			},
		} : undefined"
		:selectAction="{
			route: {
				name: 'CategoryList',
			},
		}"
	/>
</template>
```

## Form submission

`useCollectionFormSubmit()` handles create/edit/copy modes, changed-field updates, reference mapping, validation, and error normalization.

```ts
const errors = useFormErrors();

const submitter = useCollectionFormSubmit<
	Product,
	ProductKey,
	ProductNew,
	ProductUpd
>({
	api: productApi,
	mode,
	key,
	fields: [
		"name",
		"price",
		"active",
		{
			detailField: "category_ref",
			kind: "reference",
			reference: {
				mode: "keys",
			},
		},
	],
	createSchema: ProductNewSchema,
	updateSchema: ProductUpdSchema,
	errors,
});
```

After loading an edit model, store its initial value:

```ts
const detail = await productApi.detail(key.value);
form.value = detail;
submitter.setInitialModel(detail);
```

Then submit the current detail model:

```ts
const submitForm = async (): Promise<void> => {
	await submitter.submit(form.value);
};
```

Reference mapping modes are:

- `keys`: `{ keys: { id: 123 }, descr: "A" }` becomes `{ id: 123 }`;
- `key`: submits one configured key value;
- `value`: submits the complete reference object.

## Dirty-form guard

Wrap the routed edit area once:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

import { CollectionDirtyGuard } from "@katren/vue-collection-lib";

const route = useRoute();
const enabled = computed(() => {
	return typeof route.name === "string"
		&& /(Create|Edit|Copy)$/.test(route.name);
});
</script>

<template>
	<CollectionDirtyGuard :enabled="enabled">
		<router-view />
	</CollectionDirtyGuard>
</template>
```

The guard observes `input` and `change` events inside forms. On route leave it offers save, discard, or cancel. Browser refresh and tab close use the browser-native warning.

Add `data-collection-ignore-dirty="true"` to utility forms that must not mark the page dirty.

## WebSocket CRUD refresh

Provide one shared `WSManager` before mounting the application:

```ts
import {
	provideWSManager,
	WSManager,
} from "@katren/vue-collection-lib";

const wsManager = new WSManager("/ws", {
	reconnectInterval: 3_000,
	maxReconnectAttempts: 0,
});

provideWSManager(app, wsManager);
wsManager.connect();
```

When a CRUD API has `serviceName: "Product"`, `CollectionGrid` subscribes to:

```text
Product.Create
Product.Update
Product.Delete
```

The grid debounces matching events, reloads its current page, restores subscriptions after reconnect, and unsubscribes on unmount.

Use these props to control the behavior:

```vue
<CollectionGrid
	eventService="Product"
	:autoRefreshOnCrud="true"
	:eventRefreshDelay="100"
/>
```

For Nuxt, create the manager in a `.client.ts` plugin because `WebSocket` and `window` are browser APIs. See `examples/nuxt/plugins/collection-lib.client.ts`.

## Public imports

The root export contains the normal public API:

```ts
import {
	CollectionGrid,
	ReferenceInput,
	CollectionDirtyGuard,
	Conn,
	createCrudApi,
	useCollectionFormSubmit,
	useFormErrors,
	type GridColumn,
} from "@katren/vue-collection-lib";
```

Focused subpath exports are also available:

```ts
import { collectionLibMessages } from "@katren/vue-collection-lib/locales";
import { CollectionGrid } from "@katren/vue-collection-lib/components/crudGrid";
import { ReferenceInput } from "@katren/vue-collection-lib/components/reference";
import { useFormErrors } from "@katren/vue-collection-lib/composables/form";
```

## Examples

The `examples/` directory contains:

- a typed REST API and DTO conversion;
- a routed CRUD grid;
- reference filtering and autocomplete;
- reference creation through a generated dialog or an existing page;
- a Valibot-backed create/edit/copy form;
- a Nuxt client WebSocket plugin.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

`npm run check` performs source and example type checking, Node regression tests, and mounted Vue component tests. Run `npm run test:components` to run only the component tests.

See `PUBLISHING.md` for the release checklist.

## License

MIT.
