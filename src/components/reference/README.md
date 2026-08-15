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
