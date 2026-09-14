<script setup lang="ts">
import type { CollectionHierarchyBreadcrumb } from "../../types/collectionHierarchy";

const props = defineProps<{
	rootLabel: string;
	rootIcon?: string;
	groupIcon?: string;
	path: CollectionHierarchyBreadcrumb[];
	disabled?: boolean;
}>();

const emit = defineEmits<{
	navigate: [displayIndex: number];
}>();
</script>

<template>
	<nav
		class="crud-grid-breadcrumbs"
		aria-label="Breadcrumb"
	>
		<button
			type="button"
			class="crud-grid-breadcrumb"
			:class="{ 'crud-grid-breadcrumb-current': props.path.length === 0 }"
			:aria-current="props.path.length === 0 ? 'page' : undefined"
			:disabled="props.disabled"
			@click="emit('navigate', 0)"
		>
			<i :class="props.rootIcon ?? 'pi pi-home'" />
			<span>{{ props.rootLabel }}</span>
		</button>

		<template
			v-for="(item, index) in props.path"
			:key="`${String(item.id)}-${index}`"
		>
			<i class="pi pi-angle-right crud-grid-breadcrumb-separator" />
			<button
				type="button"
				class="crud-grid-breadcrumb"
				:class="{ 'crud-grid-breadcrumb-current': index === props.path.length - 1 }"
				:aria-current="index === props.path.length - 1 ? 'page' : undefined"
				:disabled="props.disabled"
				@click="emit('navigate', index + 1)"
			>
				<i :class="props.groupIcon ?? 'pi pi-folder-open'" />
				<span>{{ item.label }}</span>
			</button>
		</template>
	</nav>
</template>

<style scoped>
.crud-grid-breadcrumbs {
	align-items: center;
	background: var(--p-content-background, white);
	border: 1px solid var(--p-content-border-color, rgb(229 231 235));
	border-radius: var(--p-border-radius-md, 0.375rem);
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
	margin-bottom: 0.25rem;
	min-height: 2.25rem;
	padding: 0.25rem 0.5rem;
}

.crud-grid-breadcrumb {
	align-items: center;
	background: transparent;
	border: 0;
	border-radius: var(--p-border-radius-sm, 0.25rem);
	color: var(--p-primary-color, inherit);
	cursor: pointer;
	display: inline-flex;
	font: inherit;
	gap: 0.35rem;
	padding: 0.25rem 0.4rem;
}

.crud-grid-breadcrumb:hover:not(.crud-grid-breadcrumb-current) {
	background: var(--p-content-hover-background, rgb(243 244 246));
}

.crud-grid-breadcrumb-current {
	color: var(--p-text-color, inherit);
	cursor: default;
	font-weight: 600;
}

.crud-grid-breadcrumb:disabled {
	cursor: default;
	opacity: 0.6;
}

.crud-grid-breadcrumb-separator {
	color: var(--p-text-muted-color, rgb(107 114 128));
	font-size: 0.75rem;
}
</style>
