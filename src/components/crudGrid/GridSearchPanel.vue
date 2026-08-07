<script setup lang="ts">
import type { GridSearchCriterion } from "./types";

const props = defineProps<{
	criteria: GridSearchCriterion[];
}>();

const emit = defineEmits<{
	open: [id: string];
	remove: [id: string];
}>();
</script>

<template>
	<div
		v-if="props.criteria.length > 0"
		class="crud-grid-search-panel"
	>
		<span
			v-for="criterion in props.criteria"
			:key="criterion.id"
			class="crud-grid-search-chip"
			:title="criterion.operationLabel"
		>
			<button
				type="button"
				class="crud-grid-search-chip-open"
				@click="emit('open', criterion.id)"
			>
				<span class="crud-grid-search-chip-label">
					{{ criterion.label }}:
				</span>
				<span>{{ criterion.valueLabel }}</span>
			</button>

			<button
				v-if="criterion.removable !== false"
				type="button"
				class="crud-grid-search-chip-remove"
				@click.stop="emit('remove', criterion.id)"
			>
				<i class="pi pi-times" />
			</button>
		</span>
	</div>
</template>

<style scoped>
.crud-grid-search-panel {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
	margin: 0 0 0.25rem;
	padding: 0;
}

.crud-grid-search-chip {
	display: inline-flex;
	align-items: center;
	gap: 0.125rem;
	border: 1px solid rgb(191 219 254);
	border-radius: 9999px;
	background: rgb(239 246 255);
	font-size: 0.75rem;
	line-height: 1rem;
	color: rgb(30 64 175);
}

.crud-grid-search-chip-label {
	font-weight: 500;
}

.crud-grid-search-chip:hover {
	background: rgb(219 234 254);
}

.crud-grid-search-chip-open,
.crud-grid-search-chip-remove {
	border: 0;
	background: transparent;
	color: inherit;
	cursor: pointer;
}

.crud-grid-search-chip-open {
	display: inline-flex;
	align-items: center;
	gap: 0.1875rem;
	padding: 0.125rem 0.25rem 0.125rem 0.5rem;
}

.crud-grid-search-chip-remove {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1rem;
	height: 1rem;
	margin-right: 0.0625rem;
	border-radius: 9999px;
	font-size: 0.6875rem;
}

.crud-grid-search-chip-remove:hover {
	background: rgb(191 219 254);
}
</style>
