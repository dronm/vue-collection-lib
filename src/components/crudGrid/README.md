# CRUD grid layer

The reusable grid layer is split into:

- `CollectionGrid.vue` — PrimeVue DataTable shell: command panel, context menu, lazy server pagination, sorting, inline row editing, keyboard shortcuts, row/cell cursor, footer values, route-based edit modes.
- `GridCommandPanel.vue` — toolbar for grid commands.
- `types.ts` — grid contracts.
- `gridUtils.ts` — helpers for cloning rows and creating update objects with only modified editable columns.
- `composables/useCollectionGrid.ts` — server list state, pagination, sorting, selection, cursor movement, session state restore.
- `composables/useGridCommands.ts` — default commands and shortcut handling.

The first prototype is `views/catalogueGroup/CatalogueGroupList.vue`.

## Commands

`CollectionGrid` supports three command modes:

- `default` — ignore `commands` and use built-in commands only.
- `append` — start with built-in commands, override built-ins with matching names, then append custom commands.
- `replace` — use only `commands`; built-in names still inherit default labels, icons, shortcuts, and enabled rules unless overridden.

```vue
<CollectionGrid
	:commands="commands"
	commandsMode="append"
/>
```

```ts
const commands: GridCommand<CatalogueGroup, CatalogueGroupKey>[] = [
	{
		name: "exportSelected",
		label: "Export selected",
		icon: "pi pi-download",
		shortcut: "Ctrl+E",
		enabled: (row) => row !== null,
		handler: async ({ rows, keys }) => {
			console.log("export", rows, keys);
		},
	},
];
```

To completely replace commands:

```vue
<CollectionGrid
	:commands="commands"
	commandsMode="replace"
/>
```

To override a built-in command and prevent the default action:

```ts
const commands: GridCommand<CatalogueGroup, CatalogueGroupKey>[] = [
	{
		name: "delete",
		labelKey: "Grid.commands.delete",
		icon: "pi pi-trash",
		shortcut: "Delete",
		severity: "danger",
		handler: async ({ keys, reload }) => {
			await customDelete(keys);
			await reload();
		},
	},
];
```

To run custom logic and then the built-in command, set `runDefault: true`.

Context menu commands use the same command model. If `contextCommands` is omitted, the context menu uses `commands` and `commandsMode`. If `contextCommands` is provided, `contextCommandsMode` controls how it is resolved. Use `:showContextMenu="false"` to disable the context menu. Do not use `:contextCommands="false"`; `contextCommands` is array-only to avoid Vue boolean prop casting for omitted props.

## Native inline creation

When `editMode="inline"`, `CollectionGrid` can create records directly in the grid. Provide `createRow` to build a fresh list-model draft. The standard `create` command then prepends that draft, enters row edit mode, and uses the row editor check/cancel buttons to save or discard it.

```ts
const createRow = (): ProductBrandGroup => ({
	id: 0,
	name: "",
});
```

```vue
<CollectionGrid
	:api="productBrandGroupApi"
	:columns="columns"
	dataKey="id"
	:getKey="getKey"
	:createRow="createRow"
	editMode="inline"
/>
```

By default, the create payload contains every column marked `editable: true`. If the list model differs from the API create model, provide `createModel`:

```ts
const createModel = (row: ProductRow): ProductNew => ({
	name: row.name,
	category_id: row.category_ref?.keys.id ?? null,
});
```

`createRow` should populate key fields with a safe temporary value (for example `id: 0` or a negative ID), because the grid may call `getKey()` while the draft is selected. Only one inline edit/create session is active at a time. While it is active, collection commands, sorting, paging, context commands, keyboard shortcuts, and WebSocket auto-refresh are suspended. Cancel removes a new draft without calling the API; save calls `api.create()`, emits `rowCreate`, and reloads the collection. If `createRow` is omitted, the create command keeps its previous route/`create` event behavior.

## Inline edit reactivity

`CollectionGrid` guarantees that every row draft exposed to an inline editor is reactive, even though PrimeVue creates the underlying edit-row clone as a plain object. All built-in editors use one write path, `applyGridInlineValue()`: it optionally normalizes the raw editor value, assigns the edited field, then invokes the optional `GridColumn.setValue` hook on the same reactive draft.

Use `normalizeValue` for field-local conversion and keep cross-field business rules in `setValue` instead of repeating assignment or adding form-specific reactivity workarounds:

```ts
const columns: GridColumn<ReceiptItem>[] = [
	{
		field: "price",
		headerKey: "ReceiptItem.fields.price",
		editable: true,
		dataType: "number",
		normalizeValue: (value) => Math.round(Number(value ?? 0) * 100) / 100,
		setValue: (row) => {
			row.amount = row.quant * row.price;
		},
	},
];
```

The same guarantee applies to custom editor slots: `data` is the reactive edit draft and `updateValue(value)` uses the same common write path as the built-in editors. Prefer `updateValue()` over assigning the edited field directly. Do not call `reactive()` in application grids just to support dependent fields.

## Search

`CollectionGrid` includes a built-in `search` command. If a grid uses `commandsMode="replace"`, add the command explicitly:

```ts
const commands: GridCommand<MyRow, MyKey>[] = [
	{ name: "create" },
	{ name: "edit" },
	{ name: "delete" },
	{ name: "search" },
	{ name: "refresh" },
];
```

Search is configured per column. By default every column is searchable, the backend field equals the grid field, and the type is taken from `dataType` or defaults to `"string"`.

```ts
const columns: GridColumn<MyRow>[] = [
	{
		field: "name",
		headerKey: "My.fields.name",
		dataType: "string",
		searchable: true,
	},
	{
		field: "price",
		headerKey: "My.fields.price",
		dataType: "number",
		searchField: "price",
	},
];
```

Text columns support:

- `begins`: `ILIKE 'value%'`
- `contains`: `ILIKE '%value%'`
- `exact`: `= value`

Boolean and reference columns support exact search by default. Number and date columns support exact and range search by default.

Reference columns can map reference keys to backend filter fields:

```ts
{
	field: "owner_ref",
	headerKey: "My.fields.owner",
	dataType: "reference",
	searchDataType: "reference",
	searchReferenceAutocomplete: ownerAutocomplete,
	searchReferenceKeys: {
		id: "owner_id",
	},
}
```

Applied criteria are displayed as chips under the command panel. Clicking a chip reopens the search dialog for that criterion. Removing a chip reloads the grid. Criteria are stored in grid state when `stateKey` is set.

## Selection and search notes

`CollectionGrid` now defaults to cell selection. Set `rowSelection` to `true` when you need the previous row-only cursor behavior.

Pointer selection focuses the grid without scrolling the document. This preserves keyboard shortcuts and arrow navigation while preventing Chromium-based browsers from moving the collection to the top of the viewport between the two clicks of a double-click. Interactive controls inside rows keep their normal browser focus behavior.

Grid-level keyboard handling is suspended while an inline row is actively being edited. Key events originating from inputs, selects, textareas, contenteditable elements, and ARIA editor controls are also ignored by the grid, so typing in an inline editor does not open search or trigger collection shortcuts.

`Enter` activates the current row with the same behavior as a row double-click. In a normal collection this runs the `edit` command. When the collection was opened by `ReferenceInput` as a selection picker, both `Enter` and double-click return the current row to the reference field and close the picker.

In cell selection mode the grid stores both the current row and current column. `Ctrl+F`, the command-panel search command, and a new search dialog use the current cell column as the initial search column when no existing criterion is being edited.

String search operations are shown as radio buttons. Number and date columns support `exact` and `range` operations by default. A range creates separate `>=` and `<=` filters for the same server-side search field.

Date columns are searched as a local calendar day by default. An exact date search becomes two filters:

- `field >= YYYY-MM-DDT00:00:00.000`
- `field <= YYYY-MM-DDT23:59:59.999`

Set `searchDateOnly: false` on a column when the server expects exact datetime values instead.

For formatted columns, keep display formatting and server filtering separate. Use `searchComponent` for a masked/formatted input, `searchValueToFilter` to convert the UI value to raw server data, and `searchValueLabel` for the chip label.

```ts
const onlyDigits = (value: unknown): string => {
	return String(value ?? "").replace(/\D/g, "");
};

const phoneColumn = {
	field: "phone",
	headerKey: "phone",
	dataType: "string",
	format: (value: unknown): string => formatPhone(String(value ?? "")),
	searchComponent: PhoneInput,
	searchValueToFilter: (value: unknown): string => onlyDigits(value),
	searchValueLabel: (value: unknown): string => formatPhone(String(value ?? "")),
};
```

## DatePicker locale/date format

The search dialog uses PrimeVue `DatePicker` without hardcoding a locale. Configure the project-level PrimeVue locale once so every DatePicker uses Russian labels and `dd.mm.yy` input formatting.

```ts
import { ru } from "primelocale/js/ru.js";

export default defineNuxtConfig({
	primevue: {
		options: {
			locale: {
				...ru,
				dateFormat: "dd.mm.yy",
				firstDayOfWeek: 1,
			},
		},
	},
});
```

For non-Nuxt Vue projects, pass the same `locale` object to `app.use(PrimeVue, { locale })`.

## Automatic refresh from CRUD events

When the host application provides a `WSManager` and the grid API has `serviceName`, `CollectionGrid` automatically subscribes to:

- `ServiceName.Create`;
- `ServiceName.Update`;
- `ServiceName.Delete`.

The grid debounces incoming events and reloads its current page. It unsubscribes on unmount and restores subscriptions after WebSocket reconnection.

```ts
const productApi = createCrudApi({
	api,
	basePath: "/products",
	serviceName: "Product",
	getKeyValue: (key) => key.id,
	fromListDTO,
	fromDetailDTO,
});
```

Use `eventService` on `CollectionGrid` to override the API metadata, `autoRefreshOnCrud` to disable event refresh, and `eventRefreshDelay` to change the debounce delay.

## Hierarchical collections

`CollectionGrid` can optionally interpret a collection as a hierarchy. The default contract is `parent_id`, `is_group`, `id` (from `dataKey`), and `name` (breadcrumb label):

```vue
<CollectionGrid
	:api="productApi"
	:columns="columns"
	dataKey="id"
	:getKey="getKey"
	:hierarchy="{}"
/>
```

Hierarchy mode scopes the server request through `CollectionParams`:

- root: `parent_id IS NULL`;
- group: `parent_id = currentGroupId`;
- flat mode: no hierarchy filter.

Search criteria remain independent and are appended to the base hierarchy filters. This lets the same search become current-group search in hierarchy mode and global search in flat mode.

The toolbar automatically adds Create group and an icon-only hierarchy/flat switch. Breadcrumbs appear directly below the toolbar in hierarchy mode. The current hierarchy path survives flat mode and is restored when hierarchy mode is selected again.

Inline creation receives structural initial values through `GridCreateContext` and forcibly merges them into the create payload. Page/tab create routes can accept the same context from `GridRouteConfig.create`.

Default reference-picker eligibility is elements only. Configure `hierarchy.selectable` when groups are valid reference values.
