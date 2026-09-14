<script setup lang="ts">
import { useI18n } from "vue-i18n";

import Button from "primevue/button";

const props = withDefaults(defineProps<{
	submitting?: boolean;
	cancelLabel?: string;
	saveLabel?: string;
}>(), {
	submitting: false,
	cancelLabel: "",
	saveLabel: "",
});

const emit = defineEmits<{
	cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
	<div class="flex justify-end gap-2">
		<Button
			type="button"
			:label="props.cancelLabel || t('Grid.commands.cancel')"
			severity="secondary"
			outlined
			:disabled="props.submitting"
			@click="emit('cancel')"
		/>
		<Button
			type="submit"
			:label="props.saveLabel || t('Grid.commands.save')"
			:loading="props.submitting"
			icon="pi pi-check"
		/>
	</div>
</template>
