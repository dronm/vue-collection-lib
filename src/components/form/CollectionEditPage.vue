<script setup lang="ts">
import { useI18n } from "vue-i18n";

import Button from "primevue/button";

const props = withDefaults(defineProps<{
	title: string;
	loading?: boolean;
}>(), {
	loading: false,
});

const emit = defineEmits<{
	back: [];
}>();

const { t } = useI18n();
</script>

<template>
	<section class="py-4">
		<div class="mb-4 flex items-center justify-between gap-3">
			<h1 class="text-2xl font-semibold">{{ props.title }}</h1>
			<Button
				:label="t('Grid.commands.back')"
				icon="pi pi-arrow-left"
				severity="secondary"
				outlined
				@click="emit('back')"
			/>
		</div>
		<div v-if="props.loading" class="rounded-md border border-gray-200 p-4">
			{{ t("Grid.loading") }}
		</div>
		<div v-else class="rounded-md border border-gray-200 bg-white p-4">
			<slot />
		</div>
	</section>
</template>
