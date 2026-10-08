<script setup lang="ts" generic="TModel extends object, TKey, TNew, TUpd extends object, TDetailModel extends object = TModel">
import { useId } from "vue";
import { useI18n } from "vue-i18n";

import Button from "primevue/button";

import type { CollectionDefinition } from "../../types/collectionDefinition";
import type { GridCreateContext } from "../crudGrid/types";
import GridFieldEditor from "../crudGrid/GridFieldEditor.vue";
import FormField from "./FormField.vue";
import FormErrorSummary from "./FormErrorSummary.vue";
import { useCollectionCreate } from "../../composables/form/useCollectionCreate";

const props = defineProps<{
	collection: CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel>;
	context?: GridCreateContext;
}>();

const emit = defineEmits<{
	created: [detail: TDetailModel, key: TKey];
	cancel: [];
}>();

const { t } = useI18n();
const formId = useId();
const {
	draft,
	errors,
	editableColumns,
	available,
	submitting,
	created,
	updateValue,
	submit: submitCreate,
} = useCollectionCreate({ collection: props.collection, context: props.context });

const getDraft = (): TModel => draft;

const submit = async (): Promise<void> => {
	const result = await submitCreate();
	if (result !== null) {
		emit("created", result.detail, result.key);
	}
};

defineExpose({ submitting, created, errors, submit });
</script>

<template>
	<form
		class="collection-create-form"
		data-collection-ignore-dirty
		@submit.prevent.stop="submit"
	>
		<FormErrorSummary :errors="errors" />
		<p v-if="created" class="text-sm" role="status">
			{{ t('Reference.create.savedSelectionPending') }}
		</p>
		<FormField
			v-for="column in editableColumns"
			:key="column.field"
			:field="column.field"
			:label="column.header ?? t(column.headerKey)"
			:forId="`${formId}-${column.field}`"
			:errors="errors"
			containerClass="collection-create-field"
		>
			<GridFieldEditor
				:id="`${formId}-${column.field}`"
				:column="column"
				:row="getDraft()"
				:modelValue="getDraft()[column.field]"
				:projectedValue="column.referenceField ? getDraft()[column.referenceField] : undefined"
				:disabled="submitting || created || !available"
				:invalid="errors.has(column.field)"
				:class="column.dataType === 'boolean' && !column.editorComponent ? undefined : 'w-full'"
				@update:modelValue="updateValue(column, $event)"
			/>
		</FormField>
		<div class="collection-create-actions">
			<Button
				type="button"
				:label="t('Grid.commands.cancel')"
				severity="secondary"
				outlined
				:disabled="submitting"
				@click="emit('cancel')"
			/>
			<Button
				type="submit"
				:label="created ? t('Reference.create.retrySelection') : t('Grid.commands.save')"
				:loading="submitting"
				:disabled="!available"
				icon="pi pi-check"
			/>
		</div>
	</form>
</template>

<style scoped>
.collection-create-form {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	min-width: 0;
}

.collection-create-field {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
}

.collection-create-field :deep(input),
.collection-create-field :deep(.p-inputnumber),
.collection-create-field :deep(.p-select),
.collection-create-field :deep(.p-datepicker) {
	min-width: 0;
	width: 100%;
}

.collection-create-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	justify-content: flex-end;
}
</style>
