<script setup lang="ts" generic="TModel extends object">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import Checkbox from "primevue/checkbox";
import DatePicker from "primevue/datepicker";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";

import ReferenceKeyInput from "../reference/ReferenceKeyInput.vue";
import type { GridColumn } from "./types";
import {
	gridDatePickerProps,
	isGridDateDataType,
	resolveGridEnumOptionLabel,
} from "./gridUtils";

const props = withDefaults(defineProps<{
	column: GridColumn<TModel>;
	row: TModel;
	modelValue?: any;
	projectedValue?: unknown;
	id?: string;
	disabled?: boolean;
	invalid?: boolean;
}>(), {
	disabled: false,
	invalid: false,
});

const emit = defineEmits<{
	"update:modelValue": [value: unknown];
}>();

const { t } = useI18n();
const resolvedEnumOptions = computed(() => {
	return (props.column.enumOptions ?? []).map((option) => ({
		...option,
		label: resolveGridEnumOptionLabel(option, t),
	}));
});
const controlDisabled = computed(() => {
	return props.disabled || Boolean(props.column.editorProps?.disabled);
});
const controlInvalid = computed(() => {
	return props.invalid || Boolean(props.column.editorProps?.invalid);
});
const controlId = computed(() => {
	return props.id ?? props.column.editorProps?.id as string | undefined;
});
const inputId = computed(() => {
	return props.id ?? props.column.editorProps?.inputId as string | undefined;
});
</script>

<template>
	<component
		:is="props.column.editorComponent"
		v-if="props.column.editorComponent"
		v-bind="props.column.editorProps"
		:id="controlId"
		:modelValue="props.modelValue"
		:row="props.row"
		:column="props.column"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<ReferenceKeyInput
		v-else-if="props.column.dataType === 'reference' && props.column.reference"
		v-bind="props.column.editorProps"
		:id="controlId"
		:modelValue="props.modelValue"
		:projectedValue="props.projectedValue"
		:reference="props.column.reference"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<Checkbox
		v-else-if="props.column.dataType === 'boolean'"
		v-bind="props.column.editorProps"
		:inputId="inputId"
		:modelValue="props.modelValue"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		binary
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<InputNumber
		v-else-if="props.column.dataType === 'number'"
		v-bind="props.column.editorProps"
		:inputId="inputId"
		:modelValue="props.modelValue"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<DatePicker
		v-else-if="isGridDateDataType(props.column.dataType)"
		v-bind="gridDatePickerProps(props.column.dataType, props.column.editorProps)"
		:inputId="inputId"
		:modelValue="props.modelValue"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<Select
		v-else-if="props.column.dataType === 'enum'"
		v-bind="props.column.editorProps"
		:inputId="inputId"
		:modelValue="props.modelValue"
		:options="resolvedEnumOptions"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		optionLabel="label"
		optionValue="value"
		optionDisabled="disabled"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
	<InputText
		v-else
		v-bind="props.column.editorProps"
		:id="controlId"
		:modelValue="props.modelValue"
		:disabled="controlDisabled"
		:invalid="controlInvalid"
		@update:modelValue="emit('update:modelValue', $event)"
	/>
</template>
