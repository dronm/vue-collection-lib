<script setup lang="ts">
import type { FormErrorsView } from "../../types/formErrors";

const props = defineProps<{
	errors?: FormErrorsView;
}>();
</script>

<template>
	<div
		v-if="props.errors?.formErrors.length"
		class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
	>
		<div v-for="message in props.errors.formErrors" :key="message">
			{{ message }}
		</div>
	</div>
</template>
