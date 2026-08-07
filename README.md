# @katren/vue-collection-lib

Reusable Vue 3 and PrimeVue building blocks for data-oriented web applications.

The package provides a server-driven CRUD grid, reference/autocomplete input, form mutation and validation helpers, an HTTP client, WebSocket subscriptions, and English/Russian locale messages.

## Features

- PrimeVue `DataTable` CRUD grid with lazy pagination and server sorting;
- built-in create, edit, copy, delete, search, and refresh commands;
- keyboard shortcuts, row marking, cell cursor, context menu, and persisted grid state;
- string, number, boolean, date, range, and reference search criteria;
- inline, modal, page, and tab edit modes;
- automatic collection reload after WebSocket CRUD events;
- reference autocomplete with open, select, and clear actions;
- create/update payload generation with changed fields only;
- reference-to-key payload mapping;
- Valibot validation and normalized API/field errors;
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
	transformJSON,
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

const fromDTO = (dto: ProductDTO): Product => {
	const model = transformJSON(dto);

	return {
		...model,
		price: Number(model.price),
	};
};

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

### Search

Search behavior is configured per column. Text fields support begins, contains, and exact matching. Number and date fields support exact and range matching. Reference columns map reference keys to backend filter fields.

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
- a Valibot-backed create/edit/copy form;
- a Nuxt client WebSocket plugin.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

`npm run check` performs source type checking, example type checking, and regression tests.

See `PUBLISHING.md` for the release checklist.

## License

MIT.
