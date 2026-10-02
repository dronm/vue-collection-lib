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
