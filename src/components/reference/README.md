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
		@select-request="openObjectCollection"
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
