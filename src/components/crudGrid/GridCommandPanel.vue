<script setup lang="ts">
import Button from "primevue/button";

import type { GridCommandRuntime } from "./types";

type GridCommandPanelItem = Pick<
	GridCommandRuntime<any>,
	"name" | "label" | "icon" | "picture" | "iconOnly" | "shortcut" | "disabled" | "severity"
>;

const props = withDefaults(defineProps<{
	commands: GridCommandPanelItem[];
	showShortcuts?: boolean;
}>(), {
	showShortcuts: true,
});

const emit = defineEmits<{
	command: [name: string];
}>();

const buttonLabel = (command: GridCommandPanelItem): string => {
	return props.showShortcuts && command.shortcut
		? `${command.label} (${command.shortcut})`
		: command.label;
};
</script>

<template>
	<div class="crud-grid-command-panel">
		<Button
			v-for="command in props.commands"
			:key="command.name"
			:icon="command.icon ?? command.picture"
			:label="command.iconOnly ? undefined : buttonLabel(command)"
			:title="command.iconOnly ? buttonLabel(command) : undefined"
			:aria-label="command.iconOnly ? buttonLabel(command) : undefined"
			:disabled="command.disabled"
			:severity="command.severity"
			outlined
			size="small"
			@click="emit('command', command.name)"
		/>
	</div>
</template>

<style scoped>
.crud-grid-command-panel {
	align-items: center;
	background: var(--p-content-background, white);
	border: 1px solid var(--p-content-border-color, rgb(229 231 235));
	border-radius: var(--p-border-radius-md, 0.375rem);
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-bottom: 0.25rem;
	padding: 0.5rem;
}
</style>
