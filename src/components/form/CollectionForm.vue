<script setup lang="ts">
import type { FormErrorsView } from "../../types/formErrors";
import FormActions from "./FormActions.vue";
import FormErrorSummary from "./FormErrorSummary.vue";

const props = withDefaults(defineProps<{
	errors?: FormErrorsView;
	submitting?: boolean;
	showActions?: boolean;
}>(), {
	errors: undefined,
	submitting: false,
	showActions: true,
});

const emit = defineEmits<{
	submit: [];
	cancel: [];
}>();
</script>

<template>
	<form class="space-y-4" @submit.prevent="emit('submit')">
		<FormErrorSummary :errors="props.errors" />
		<slot />
		<slot name="actions">
			<FormActions
				v-if="props.showActions"
				:submitting="props.submitting"
				@cancel="emit('cancel')"
			/>
		</slot>
	</form>
</template>
