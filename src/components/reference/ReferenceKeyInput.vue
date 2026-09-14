<script setup lang="ts" generic="TRow extends ReferenceRow, TKeys extends ReferenceKeys, TValue extends ReferenceKeyValue">
import {
	computed,
	shallowRef,
	ref,
	watch,
} from "vue";

import type {
	ReferenceKeys,
	ReferenceKeyValue,
	ReferenceRow,
	ReferenceValue,
} from "../../types/reference";
import type { CrudReferenceDefinition } from "../../types/referenceDefinition";
import ReferenceInput from "./ReferenceInput.vue";

const props = withDefaults(defineProps<{
	modelValue?: TValue | null;
	/** Reference object from the read projection; must match modelValue. */
	projectedValue?: unknown;
	reference: CrudReferenceDefinition<TRow, TKeys, TValue>;
	id?: string;
	label?: string;
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	invalid?: boolean;
	error?: string | null;
	showOpen?: boolean;
	showSelect?: boolean;
	showClear?: boolean;
	openTitle?: string;
	selectTitle?: string;
	clearTitle?: string;
}>(), {
	modelValue: null,
	disabled: false,
	required: false,
	invalid: false,
	error: null,
	showOpen: true,
	showSelect: true,
	showClear: true,
});

const emit = defineEmits<{
	"update:modelValue": [value: TValue | null];
}>();

const referenceValue = shallowRef<ReferenceValue<TKeys> | null>(null);
const loading = ref(false);
let loadVersion = 0;

watch(
	() => [props.modelValue, props.projectedValue, props.reference] as const,
	async ([value, projectedValue]) => {
		const version = ++loadVersion;
		loading.value = false;
		if (projectedValue === undefined && props.reference.valueFromReference(referenceValue.value) === value) {
			return;
		}

		loading.value = true;
		try {
			const loaded = await props.reference.load(value, projectedValue);
			if (version === loadVersion) {
				referenceValue.value = loaded;
			}
		} finally {
			if (version === loadVersion) {
				loading.value = false;
			}
		}
	},
	{ immediate: true },
);

const updateReference = (value: ReferenceValue<TKeys> | null): void => {
	++loadVersion;
	loading.value = false;
	referenceValue.value = value;
	const nextValue = props.reference.valueFromReference(value);
	// Keep the selected description for subsequent grid renders.
	if (value !== null) {
		void props.reference.load(nextValue, value);
	}
	if (nextValue !== props.modelValue) {
		emit("update:modelValue", nextValue);
	}
};

const openAction = computed(() => {
	if (!props.reference.openRoute) {
		return undefined;
	}

	return {
		route: props.reference.openRoute,
		target: props.reference.openTarget,
	};
});

const selectAction = computed(() => {
	if (!props.reference.selectRoute) {
		return undefined;
	}

	return {
		route: props.reference.selectRoute,
		target: props.reference.selectTarget,
	};
});
</script>

<template>
	<ReferenceInput
		:id="props.id"
		:modelValue="referenceValue"
		:label="props.label"
		:placeholder="props.placeholder"
		:autocomplete="props.reference.autocomplete"
		:disabled="props.disabled || loading"
		:required="props.required"
		:invalid="props.invalid"
		:error="props.error"
		:showOpen="props.showOpen && Boolean(openAction)"
		:showSelect="props.showSelect && Boolean(selectAction)"
		:showClear="props.showClear"
		:openAction="openAction"
		:selectAction="selectAction"
		:openTitle="props.openTitle"
		:selectTitle="props.selectTitle"
		:clearTitle="props.clearTitle"
		@update:modelValue="updateReference"
	/>
</template>
