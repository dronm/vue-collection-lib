<script setup lang="ts" generic="TRow extends ReferenceRow, TKeys extends ReferenceKeys, TValue extends ReferenceKeyValue">
import {
	ref,
	watch,
} from "vue";

import type {
	ReferenceKeys,
	ReferenceKeyValue,
	ReferenceRow,
} from "../../types/reference";
import type { CrudReferenceDefinition } from "../../types/referenceDefinition";

const props = defineProps<{
	modelValue?: TValue | null;
	/** Reference object from the read projection; must match modelValue. */
	projectedValue?: unknown;
	reference: CrudReferenceDefinition<TRow, TKeys, TValue>;
}>();

const label = ref("");
let loadVersion = 0;

watch(
	() => [props.modelValue, props.projectedValue, props.reference] as const,
	async ([value, projectedValue]) => {
		const version = ++loadVersion;
		const reference = await props.reference.load(value, projectedValue);
		if (version === loadVersion) {
			label.value = reference?.descr ?? "";
		}
	},
	{ immediate: true },
);
</script>

<template>
	<span>{{ label }}</span>
</template>
