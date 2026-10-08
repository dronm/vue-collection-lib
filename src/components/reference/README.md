# Reference fields

A reference field is stored in detail/list models as:

```ts
{
	keys: {
		id: 123,
	},
	descr: "object A",
}
```

Use `ReferenceInput.vue` for editing. The component keeps the full reference object in the form model, but `useFormMutation()` can submit only the key part.

```vue
<script setup lang="ts">
import { ReferenceInput } from "@katren/vue-collection-lib";
import { referenceAutocompleteEq } from "@katren/vue-collection-lib";
import { objectApi } from "@/api/object";

const objectAutocomplete = referenceAutocompleteEq({
	searchField: "name",
	keyFields: ["id"],
	descrFields: ["name"],
	list: objectApi.list,
});
</script>

<template>
	<ReferenceInput
		v-model="form.field_ref"
		:autocomplete="objectAutocomplete"
		:openAction="{
			route: (value) => ({
				name: 'objectEdit',
				params: value.keys ?? {},
			}),
		}"
		:selectAction="{
			route: () => ({ name: 'objects' }),
			target: '_blank',
		}"
	/>
</template>
```

Submit mapping example:

```ts
const mutation = useFormMutation<DetailModel, NewModel, UpdModel>({
	fields: [
		"name",
		{
			detailField: "field_ref",
			submitField: "field_ref",
			kind: "reference",
			reference: {
				mode: "keys",
			},
		},
	],
});

const createModel = mutation.buildCreateModel(form.value);
const updateModel = mutation.buildUpdateModel(form.value);
```

With `mode: "keys"`, `{ keys: { id: 123 }, descr: "object A" }` submits as `{ id: 123 }`.

With `mode: "key", keyField: "id"`, it submits as `123`.

## Select from collection

When `selectAction.target` is `_blank`, `ReferenceInput` opens the configured collection route as a picker. The library adds an internal selection token to the route; `CollectionGrid` detects it automatically and shows a selection-mode banner. No changes are required in the target list view.

In selection mode:

- create/edit/copy/delete and the context menu are suppressed; search and refresh remain available;
- double-clicking a row or pressing `Enter` returns that row to the originating `ReferenceInput`;
- the selected row is converted with the same `keyFields`/`descrFields` autocomplete configuration, so the reference description is immediately available;
- the picker tab closes after selection.

`selectAction` values that do not target `_blank` keep their normal navigation behavior.

### Hiding the application shell in picker windows

The library exports `useReferenceSelectionMode()` so the host application's shell can
hide navigation and remove layout offsets while a collection is being used as a picker:

```vue
<script setup lang="ts">
import { useReferenceSelectionMode } from "@katren/vue-collection-lib";

const referenceSelectionMode = useReferenceSelectionMode();
</script>

<template>
	<AppMenu v-if="!referenceSelectionMode" />

	<main :class="{ 'lg:pl-64': !referenceSelectionMode }">
		<router-view />
	</main>
</template>
```

Collection pages themselves do not need any special handling.

## Styling unselected text after blur

When a user leaves visible, nonblank text without selecting a reference, `ReferenceInput` adds `crud-reference-input--unselected` to both its wrapper and the native autocomplete input. The class is absent on initial render and while the input is focused. Focusing the input, selecting a record, or clearing the value removes it. If `forceSelection` visibly clears unmatched text on blur, the empty input remains unmarked.

This class is independent of validation errors. The library does not apply a default color; the application can style it. For example, add this to a global stylesheet to make the unselected text red:

```css
input.crud-reference-input--unselected {
	color: #dc2626;
}
```

Target the wrapper class instead when styling the entire reference control. The same behavior is available through `ReferenceKeyInput` and built-in grid reference editors.

## Creating a referenced element

Configure `create` on `defineCrudReference()` to show a Create new button next to the reference input. Without this property the button is hidden. The definition is shared by `ReferenceKeyInput` in forms and by columns using `dataType: "reference"` in grids.

### Generated creation dialog

The dialog reuses the referenced collection's metadata. It needs `createRow` to initialize a draft and `api.create` to save it. Provide `api.detail` or `loadCreated` on the collection to load the saved record before selecting it.

```ts
import * as v from "valibot";
import {
	defineCollection,
	defineCrudReference,
	type GridColumn,
} from "@katren/vue-collection-lib";
import { categoryApi } from "@/api/category";

interface Category {
	id: number;
	name: string;
}

type CategoryKey = { id: number };
type CategoryNew = Omit<Category, "id">;
type CategoryUpd = Partial<CategoryNew>;

export const categoryCollection = defineCollection<
	Category,
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

export const categoryReference = defineCrudReference<Category, CategoryKey>({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
	selectRoute: { name: "CategoryList" },
	create: {
		mode: "dialog",
		collection: () => categoryCollection,
		title: "Create category",
		prefill: (text) => ({ name: text.trim() }),
	},
});

interface ProductRow {
	id: number;
	category_id: number | null;
}

export const productColumns: GridColumn<ProductRow>[] = [
	{
		field: "category_id",
		headerKey: "Product.fields.category",
		editable: true,
		dataType: "reference",
		reference: categoryReference,
	},
];
```

In a standalone form, use the same reference:

```vue
<ReferenceKeyInput
	v-model="form.category_id"
	:reference="categoryReference"
	:showCreate="canCreateCategory"
/>
```

For a form storing a full `{ keys, descr }` reference, pass the same action to the low-level input:

```vue
<ReferenceInput
	v-model="form.category_ref"
	:autocomplete="categoryReference.autocomplete"
	:createAction="categoryReference.create"
	:showCreate="canCreateCategory"
/>
```

The dialog renders fields whose `createEditable ?? editable` is true. Use `createEditable: false` to exclude an otherwise editable field, or `createEditable: true` to include a field editable only on creation. Noneditable ID and calculated columns are omitted by default. `createModel` supplies the payload, including required values that are not displayed. Without it, the library maps the creation fields to a payload.

Built-in string, number, boolean, date, datetime, enum, and reference editors share the grid's value normalization and `setValue` hooks. `editorProps` also applies. For custom controls, declare `editorComponent` on the column: that component receives `modelValue`, emits `update:modelValue`, and can accept props from `editorProps`. Page-owned `#editor-${field}` slots cannot be discovered by the generated dialog; put reusable controls in column metadata or choose page creation.

`createSchema` validates the payload with Valibot. An optional `validateCreate(model, row)` can perform additional synchronous or asynchronous validation, throw a validation error, or return a replacement payload. Field and API errors appear in the dialog and leave the draft open.

To supply fixed values such as a hierarchy parent, add `context` to the creation configuration. It accepts a `GridCreateContext` or a function returning one:

```ts
create: {
	mode: "dialog",
	collection: () => categoryCollection,
	context: () => ({
		kind: "item",
		initialValues: { parent_id: currentParentId.value },
	}),
},
```

The context is passed to `createRow(context)`. Its `initialValues` are also applied to the draft and override the corresponding payload fields; include those fields in any creation schema and backend contract. For editable defaults, initialize them in `createRow` instead.

### Existing creation page

Use page mode for a standalone form with its own layout or business logic:

```ts
export const categoryReference = defineCrudReference<Category, CategoryKey>({
	list: categoryApi.list,
	detail: categoryApi.detail,
	keyField: "id",
	searchField: "name",
	descrFields: ["name"],
	create: {
		mode: "page",
		route: { name: "CategoryCreate" },
		target: "_blank",
		prefill: (text) => ({ name: text.trim() }),
	},
});
```

The library opens the route with an internal creation token, separate from collection-picker selection. Page creation targets a new tab; `_blank` is the default. The target route must already exist.

`useCollectionEditPage()` recognizes creation mode automatically. After a successful create, it loads the saved detail through `api.detail`, returns it to the originating input, and closes the tab. Its normal list/stay redirect is skipped for this return flow. Opening the same page without a creation token preserves its normal behavior. The composable's `goBack()` closes the creation tab when cancelling.

If loading or returning the saved detail fails after creation, the page retains `createdKey` and displays the error. Saving again retries completion for that key without creating another record. The generated dialog likewise retries the saved-detail step instead of repeating creation.

When the detail shape differs from the autocomplete row, provide `rowFromDetail` in either creation mode. It must return the row shape used by the reference's `keyField`, `descrFields`, `dataFields`, and `format`:

```ts
create: {
	mode: "page",
	route: { name: "CategoryCreate" },
	rowFromDetail: (detail) => {
		const saved = detail as { id: number; display_name: string };
		return { id: saved.id, name: saved.display_name };
	},
},
```

The returned reference keys must match the saved key from `api.create`. By default, a scalar saved key maps to the reference's single key field, while object keys use the configured key-field names. If your backend returns another shape, add `keysFromCreated: (key: unknown) => ReferenceKeys` to adapt it before validation. This is separate from `rowFromDetail`, which adapts the displayed row.

### Prefilling from typed search text

Both creation modes accept an optional `prefill` callback:

```ts
prefill: (text) => ({ name: text.trim() }),
```

The callback receives the raw, unselected text typed into the reference input. For example, typing `New category` and clicking Create new opens a draft whose name is already `New category`. The callback runs only for non-whitespace text. A blank input or the description of an existing selected record keeps the ordinary creation defaults; there is no automatic assumption that `searchField` is also the desired creation field.

Clearing the reference or selecting an existing record resets the text used for prefilling. PrimeVue's `forceSelection` may clear an unmatched input on blur; the library preserves that typed text for Create new. Cancelling creation retains the text for another attempt.

In a generated dialog, defaults are applied once after `createRow` and before the fixed `context.initialValues`. Only creation-editable column fields are accepted, and sibling reference read projections are excluded. A user can correct prefilled values before saving, and retries preserve those corrections. Like values initialized by `createRow`, these defaults do not invoke `normalizeValue` or `setValue`; those hooks run when the user edits a field. Initialize independent defaults in `createRow`, return related editable defaults together from `prefill`, and calculate derived payload values in `createModel` or `validateCreate`.

Page defaults are transferred through token-scoped browser storage, without putting the text into the route URL. Return JSON-compatible values from a page-mode callback. `useCollectionEditPage()` applies them once to a fresh creation model and preserves later edits; ordinary create pages, edit pages, and copy pages keep their usual behavior.

For a custom page, call `applyDefaultValues` after constructing the fresh model. It consumes the transferred defaults once and updates existing own fields. An optional list of allowed field names authorizes fields omitted from the factory. Unknown fields are ignored; page prefill mappings containing reserved prototype keys are rejected before opening the page.

```ts
const referenceCreation = useReferenceCreation();
const form = ref({ name: "" });

if (referenceCreation.creationMode.value) {
	referenceCreation.applyDefaultValues(form.value);
}
```

For manual mapping, `defaultValues` exposes a stable read-only snapshot, while `consumeDefaultValues()` retrieves and consumes it once. Both may be `undefined` when no defaults were transferred. Apply defaults only to a fresh create model, and preserve the user's draft during reload or retry.

### Custom form handlers

Forms that do not use `useCollectionEditPage()` can call `useReferenceCreation()`. Its `complete(key, row)` returns `false` on an ordinary page without a creation token, so that page can retain its existing redirect. In creation mode it publishes the saved row and closes the tab. Completion is bound to the token present when the hook starts; changing or removing that token prevents returning the record to another request. Its `cancel()` closes an originally launched creation tab and returns `false` for an ordinary page.

Preserve the created key before loading detail or completing the return flow. This prevents a later retry from creating the same record twice. For example, inside the creation page's `<script setup lang="ts">`:

```ts
import { ref } from "vue";
import { useRouter } from "vue-router";
import {
	useFormErrors,
	useReferenceCreation,
} from "@katren/vue-collection-lib";
import { categoryApi } from "@/api/category";

const router = useRouter();
const referenceCreation = useReferenceCreation();
const errors = useFormErrors();
const form = ref({ name: "" });
if (referenceCreation.creationMode.value) {
	referenceCreation.applyDefaultValues(form.value);
}
const createdKey = ref<{ id: number } | null>(null);
const submitting = ref(false);

const save = async (): Promise<void> => {
	if (submitting.value) {
		return;
	}
	submitting.value = true;
	errors.clear();
	try {
		// Run your normal form validation before the first create request.
		createdKey.value ??= await categoryApi.create({ name: form.value.name });
		const saved = await categoryApi.detail(createdKey.value);
		if (!referenceCreation.complete(createdKey.value, saved)) {
			await router.push({ name: "CategoryList" });
		}
	} catch (error: unknown) {
		errors.setFromError(error);
	} finally {
		submitting.value = false;
	}
};

const cancel = async (): Promise<void> => {
	if (!referenceCreation.cancel()) {
		await router.push({ name: "CategoryList" });
	}
};
```

Render the form errors and submitting state with your existing form controls. After `createdKey` is set, lock the draft fields or clearly indicate that Save retries return of the already created record. The helper's `creationMode` is a computed boolean for any page-specific presentation. The non-composable `completeReferenceCreation(key, row, options)` is also exported for handlers outside Vue setup.

### Visibility, permissions, and parent drafts

- Missing `create` always hides the button. `showCreate: false` additionally hides an otherwise configured action.
- `create.disabled: true` leaves the button visible but disables it. A disabled reference input also disables creation.
- Permission checks are explicit: the library does not infer authorization from API methods. Hide or disable the action using the application's permission state, and enforce create permissions in the backend.
- Cancelling creation preserves the previous reference. Successfully returning a saved record replaces it through the normal model-update path, including grid `normalizeValue` and `setValue` hooks.
- Creation does not submit the parent form or grid row. Saving a child dialog does not clear the parent's dirty state. Cancelling the parent later leaves the newly created catalogue record available.

## Custom suggestion and selected-value content

`ReferenceInput` supports two optional typed slots. Existing references without these slots keep their text-only appearance and behavior.

| Slot | Slot properties | Purpose |
| --- | --- | --- |
| `option` | `row: TRow`, `value: ReferenceValue<TKeys>` | Render a suggestion using its original row and normalized reference value. |
| `input-prefix` | `modelValue: ReferenceValue<TKeys> \| null`, `disabled: boolean` | Render an icon, picture, or preview button inside the selected-value field, before its editable text. |

`value` excludes the internal suggestion row. Selecting a custom suggestion still emits the same reference value through `update:modelValue`, and the original row through `select`. Put extra fields needed after selection in `autocomplete.dataFields`; those fields are copied to the reference value. When loading an already saved reference, include those extra fields in the loaded value or resolve them in the consuming component.

The prefix has a default width of `2rem` (32px at the standard root font size). The input reserves that width plus `1rem` for spacing. Set the CSS custom property `--crud-reference-input-prefix-width` on `ReferenceInput` if your prefix needs another width. Keep its height within the native input height. Without a prefix slot, no extra input padding is added.

The library does not fetch pictures or open image previews. The consuming component handles image URLs, failures, and previews. An interactive prefix should use a native `button` with `type="button"`, an accessible label, and the supplied `disabled` state; it remains keyboard-accessible and does not select an autocomplete suggestion.

For example, use thumbnails for a picture reference and open a larger image only on demand:

```vue
<script setup lang="ts">
import { ref } from "vue";
import Dialog from "primevue/dialog";
import {
	ReferenceInput,
	type ReferenceAutocompleteConfig,
	type ReferenceValue,
} from "@katren/vue-collection-lib";

type PictureRow = {
	id: number;
	name: string;
	preview_url: string;
};

type PictureKeys = { id: number };

const picture = ref<ReferenceValue<PictureKeys> | null>(null);
const previewOpen = ref(false);
const previewUrl = ref("");

const autocomplete: ReferenceAutocompleteConfig<PictureRow, PictureKeys> = {
	rows: [
		{ id: 1, name: "Picture A", preview_url: "/pictures/a.webp" },
	],
	keyFields: ["id"],
	descrFields: ["name"],
	dataFields: ["preview_url"],
};

const pictureUrl = (value: ReferenceValue<PictureKeys> | null): string => {
	return typeof value?.preview_url === "string" ? value.preview_url : "";
};

const openPreview = (value: ReferenceValue<PictureKeys> | null): void => {
	previewUrl.value = pictureUrl(value);
	previewOpen.value = Boolean(previewUrl.value);
};
</script>

<template>
	<ReferenceInput
		v-model="picture"
		:autocomplete="autocomplete"
		:showOpen="false"
		:showSelect="false"
	>
		<template #option="{ row, value }">
			<div class="picture-option">
				<img :src="row.preview_url" alt="" class="picture-option-thumbnail" />
				<span>{{ value.descr }}</span>
			</div>
		</template>

		<template #input-prefix="{ modelValue, disabled }">
			<button
				v-if="pictureUrl(modelValue)"
				type="button"
				class="picture-preview-button"
				:disabled="disabled"
				aria-label="Preview selected picture"
				@click="openPreview(modelValue)"
			>
				<img :src="pictureUrl(modelValue)" alt="" />
			</button>
			<span v-else class="pi pi-image" aria-hidden="true" />
		</template>
	</ReferenceInput>

	<Dialog v-model:visible="previewOpen" modal header="Picture preview">
		<img :src="previewUrl" alt="Selected picture" class="picture-preview" />
	</Dialog>
</template>

<style scoped>
.picture-option {
	align-items: center;
	display: flex;
	gap: 0.5rem;
	min-width: 0;
}

.picture-option-thumbnail {
	height: 40px;
	object-fit: contain;
	width: 40px;
}

.picture-preview-button {
	background: transparent;
	border: 0;
	cursor: pointer;
	height: 32px;
	padding: 0;
	width: 32px;
}

.picture-preview-button img {
	display: block;
	height: 100%;
	object-fit: contain;
	width: 100%;
}

.picture-preview {
	display: block;
	max-height: 75vh;
	max-width: min(80vw, 800px);
	object-fit: contain;
}
</style>
```
