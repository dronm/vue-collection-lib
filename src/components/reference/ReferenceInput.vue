<script setup lang="ts" generic="TRow extends ReferenceRow, TKeys extends ReferenceKeys">
import {
	computed,
	shallowRef,
} from "vue";
import { useRouter } from "vue-router";

import AutoComplete from "primevue/autocomplete";
import Button from "primevue/button";

import type {
	ReferenceAutocompleteConfig,
	ReferenceKeys,
	ReferenceRouteAction,
	ReferenceRow,
	ReferenceSelectAction,
	ReferenceValue,
} from "../../types/reference";
import {
	isReferenceValue,
	normalizeReferenceRows,
	referenceFromRow,
} from "../../utils/reference";
import { errorText } from "../../utils/errorText";

type ReferenceOption = ReferenceValue<TKeys> & {
	__row: TRow;
};

const props = withDefaults(defineProps<{
	modelValue?: ReferenceValue<TKeys> | null;
	autocomplete: ReferenceAutocompleteConfig<TRow, TKeys>;
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
	openAction?: ReferenceRouteAction<ReferenceValue<TKeys>>;
	selectAction?: ReferenceSelectAction;
	openTitle?: string;
	selectTitle?: string;
	clearTitle?: string;
}>(), {
	modelValue: null,
	disabled: false,
	required: false,
	invalid: false,
	showOpen: true,
	showSelect: true,
	showClear: true,
	openTitle: "Open",
	selectTitle: "Select",
	clearTitle: "Clear",
});

const emit = defineEmits<{
	"update:modelValue": [value: ReferenceValue<TKeys> | null];
	select: [value: ReferenceValue<TKeys>, row: TRow];
	open: [value: ReferenceValue<TKeys>];
	selectRequest: [];
	clear: [];
}>();

const router = useRouter();
const suggestions = shallowRef<ReferenceOption[]>([]);
const loading = shallowRef(false);
const searchError = shallowRef<string | null>(null);

const inputInvalid = computed(() => {
	return props.invalid || Boolean(props.error);
});

const hasActionButtons = computed(() => {
	return props.showOpen || props.showSelect || props.showClear;
});

const canOpen = computed(() => {
	return props.showOpen
		&& !props.disabled
		&& !props.openAction?.disabled
		&& Boolean(props.modelValue?.keys);
});

const canSelect = computed(() => {
	return props.showSelect
		&& !props.disabled
		&& !props.selectAction?.disabled;
});

const optionFromRow = (row: TRow): ReferenceOption => {
	return {
		...referenceFromRow(row, props.autocomplete),
		__row: row,
	};
};

const complete = async (event: { query: string }): Promise<void> => {
	const query = event.query.trim();
	const minLength = props.autocomplete.minLength ?? 1;

	if (query.length < minLength) {
		suggestions.value = [];
		return;
	}

	loading.value = true;
	searchError.value = null;

	try {
		if (props.autocomplete.rows) {
			const lowered = query.toLowerCase();
			suggestions.value = props.autocomplete.rows
				.filter((row) => {
					return referenceFromRow(row, props.autocomplete)
						.descr
						.toLowerCase()
						.includes(lowered);
				})
				.map(optionFromRow);
			return;
		}

		if (!props.autocomplete.list) {
			suggestions.value = [];
			return;
		}

		const params = props.autocomplete.queryParams
			? props.autocomplete.queryParams(query)
			: undefined;
		const response = await props.autocomplete.list(params);
		suggestions.value = normalizeReferenceRows(response).map(optionFromRow);
	} catch (err: unknown) {
		searchError.value = errorText(err);
		suggestions.value = [];
	} finally {
		loading.value = false;
	}
};

const stripOption = (
	option: ReferenceOption,
): ReferenceValue<TKeys> => {
	const {
		__row: _row,
		...value
	} = option;
	void _row;
	return value;
};

const updateModelValue = (value: unknown): void => {
	if (value === null || value === undefined || value === "") {
		emit("update:modelValue", null);
		return;
	}

	if (typeof value === "string") {
		emit("update:modelValue", {
			keys: null,
			descr: value,
		});
		return;
	}

	if (isReferenceValue<TKeys>(value)) {
		if ("__row" in value) {
			emit("update:modelValue", stripOption(value as ReferenceOption));
			return;
		}

		emit("update:modelValue", value);
	}
};

const selectOption = (event: { value: ReferenceOption }): void => {
	const selected = stripOption(event.value);
	emit("update:modelValue", selected);
	emit("select", selected, event.value.__row);
};

const openRoute = async (
	routeValue: unknown,
	target: "_self" | "_blank" | undefined,
): Promise<void> => {
	if (!routeValue) {
		return;
	}

	const route = routeValue as Parameters<typeof router.resolve>[0];

	if (target === "_blank") {
		const href = router.resolve(route).href;
		window.open(href, "_blank", "noopener,noreferrer");
		return;
	}

	await router.push(route);
};

const openCurrent = async (): Promise<void> => {
	if (!props.modelValue || !canOpen.value) {
		return;
	}

	emit("open", props.modelValue);

	const route = typeof props.openAction?.route === "function"
		? props.openAction.route(props.modelValue)
		: props.openAction?.route;

	await openRoute(route, props.openAction?.target);
};

const requestSelect = async (): Promise<void> => {
	if (!canSelect.value) {
		return;
	}

	emit("selectRequest");

	const route = typeof props.selectAction?.route === "function"
		? props.selectAction.route()
		: props.selectAction?.route;

	await openRoute(route, props.selectAction?.target);
};

const clearValue = (): void => {
	emit("update:modelValue", null);
	emit("clear");
};
</script>

<template>
	<div class="crud-reference-input">
		<label
			v-if="props.label"
			:for="props.id"
		>
			{{ props.label }}
		</label>

		<div
			class="crud-reference-input-controls"
			:class="{ 'crud-reference-input-controls--with-actions': hasActionButtons }"
		>
			<AutoComplete
				:inputId="props.id"
				:modelValue="props.modelValue"
				:suggestions="suggestions"
				optionLabel="descr"
				class="crud-reference-input-autocomplete"
				inputClass="crud-reference-input-autocomplete-input"
				:placeholder="props.placeholder"
				:disabled="props.disabled"
				:invalid="inputInvalid"
				:loading="loading"
				:delay="props.autocomplete.delay ?? 250"
				:forceSelection="props.autocomplete.forceSelection ?? false"
				:completeOnFocus="props.autocomplete.completeOnFocus ?? false"
				@complete="complete"
				@item-select="selectOption"
				@update:modelValue="updateModelValue"
			>
				<template #option="{ option }">
					<span>{{ option.descr }}</span>
				</template>
			</AutoComplete>

			<Button
				v-if="props.showOpen"
				class="crud-reference-input-action"
				icon="pi pi-external-link"
				severity="secondary"
				outlined
				:disabled="!canOpen"
				:title="props.openTitle"
				@click="openCurrent"
			/>

			<Button
				v-if="props.showSelect"
				class="crud-reference-input-action"
				icon="pi pi-list"
				severity="secondary"
				outlined
				:disabled="!canSelect"
				:title="props.selectTitle"
				@click="requestSelect"
			/>

			<Button
				v-if="props.showClear"
				class="crud-reference-input-action"
				icon="pi pi-times"
				severity="secondary"
				outlined
				:disabled="props.disabled || !props.modelValue"
				:title="props.clearTitle"
				@click="clearValue"
			/>
		</div>

		<small
			v-if="props.error"
			class="crud-reference-input-error"
		>
			{{ props.error }}
		</small>

		<small
			v-if="searchError"
			class="crud-reference-input-error"
		>
			{{ searchError }}
		</small>
	</div>
</template>


<style scoped>
.crud-reference-input {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
	width: 100%;
}

.crud-reference-input-controls {
	align-items: stretch;
	display: flex;
	gap: 0;
	min-width: 0;
	width: 100%;
}

:deep(.crud-reference-input-autocomplete) {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
	width: 100%;
}

:deep(.crud-reference-input-autocomplete input),
:deep(.crud-reference-input-autocomplete-input) {
	min-width: 0;
	width: 100%;
}

.crud-reference-input-action {
	flex: 0 0 auto;
}

.crud-reference-input-error {
	color: var(--p-red-600, rgb(220 38 38));
}

.crud-reference-input-controls--with-actions
	:deep(.crud-reference-input-autocomplete input),
.crud-reference-input-action {
	flex: 0 0 auto;
}

.crud-reference-input-error {
	color: var(--p-red-600, rgb(220 38 38));
}

.crud-reference-input-controls--with-actions
	:deep(.crud-reference-input-autocomplete-input) {
	border-bottom-right-radius: 0;
	border-top-right-radius: 0;
}

:deep(.crud-reference-input-action.p-button) {
	border-radius: 0;
	flex: 0 0 auto;
	margin-left: -1px;
}

:deep(.crud-reference-input-action.p-button:last-child) {
	border-bottom-right-radius: var(--p-button-border-radius, 6px);
	border-top-right-radius: var(--p-button-border-radius, 6px);
}
</style>
