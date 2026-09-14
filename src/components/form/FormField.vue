<script setup lang="ts">
import { computed } from "vue";

import type { FormErrorsView } from "../../types/formErrors";

const props = withDefaults(defineProps<{
	field: string;
	label?: string;
	forId?: string;
	errors?: FormErrorsView;
	labelClass?: string;
	containerClass?: string;
}>(), {
	label: "",
	forId: undefined,
	errors: undefined,
	labelClass: "",
	containerClass: "",
});

const invalid = computed(() => props.errors?.has(props.field) ?? false);
const error = computed(() => props.errors?.first(props.field) ?? "");
</script>

<template>
	<div :class="['flex flex-col gap-1', props.containerClass]">
		<label
			v-if="props.label"
			:for="props.forId"
			:class="props.labelClass"
		>
			{{ props.label }}
		</label>
		<slot :invalid="invalid" :error="error" />
		<small v-if="invalid && error" class="text-red-600">
			{{ error }}
		</small>
	</div>
</template>
