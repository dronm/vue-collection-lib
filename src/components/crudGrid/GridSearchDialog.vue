<script setup lang="ts">
import {
	computed,
	nextTick,
	onBeforeUnmount,
	ref,
	useId,
	watch,
} from "vue";
import { useI18n } from "vue-i18n";

import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";

import ReferenceInput from "../reference/ReferenceInput.vue";
import {
	isSearchRangeValue,
	searchValueIsEmpty,
} from "./gridSearchUtils";
import type {
	GridSearchColumnOption,
	GridSearchCriterion,
	GridSearchInput,
	GridSearchOperation,
	GridSearchRangeValue,
	GridSearchSingleValue,
	GridSearchValue,
} from "./types";
import type {
	ReferenceKeys,
	ReferenceValue,
} from "../../types/reference";

const props = defineProps<{
	visible: boolean;
	columns: GridSearchColumnOption[];
	criterion?: GridSearchCriterion | null;
	initialField?: string | null;
	initialValue?: string | null;
}>();

const emit = defineEmits<{
	"update:visible": [value: boolean];
	apply: [value: GridSearchInput];
}>();

const { t } = useI18n();
const selectedField = ref<string | null>(null);
const operation = ref<GridSearchOperation>("contains");
const value = ref<GridSearchValue>(null);
const valueControlRoot = ref<HTMLElement | null>(null);
const dialogOpening = ref(false);
let focusFrame: number | null = null;
let focusTimeout: ReturnType<typeof window.setTimeout> | null = null;
let secondFocusTimeout: ReturnType<typeof window.setTimeout> | null = null;

const searchFormId = useId();
const columnInputId = `${searchFormId}-column`;
const valueInputId = `${searchFormId}-value`;

const visibleModel = computed({
	get: () => props.visible,
	set: (nextValue: boolean) => {
		emit("update:visible", nextValue);
	},
});

const columnOptions = computed(() => {
	return props.columns.map((column) => {
		return {
			label: column.header,
			value: column.field,
		};
	});
});

const currentColumn = computed(() => {
	return props.columns.find((column) => column.field === selectedField.value) ?? null;
});

const operationOptions = computed(() => {
	return (currentColumn.value?.operations ?? []).map((item) => {
		return {
			label: t(`Grid.search.operations.${item}`),
			value: item,
		};
	});
});

const operationGroupName = computed(() => {
	return `crud-grid-search-operation-${selectedField.value ?? "none"}`;
});

const defaultOperationForColumn = (
	column: GridSearchColumnOption | null,
): GridSearchOperation => {
	if (!column) {
		return "exact";
	}

	if (column.dataType === "string" && column.operations.includes("contains")) {
		return "contains";
	}

	if (column.operations.includes("exact")) {
		return "exact";
	}

	return column.operations[0] ?? "exact";
};

const rangeValue = computed<GridSearchRangeValue>({
	get: () => {
		if (isSearchRangeValue(value.value)) {
			return value.value;
		}

		return {
			from: null,
			to: null,
		};
	},
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const rangeFromValue = computed<GridSearchSingleValue>({
	get: () => rangeValue.value.from,
	set: (nextValue) => {
		rangeValue.value = {
			...rangeValue.value,
			from: nextValue,
		};
	},
});

const rangeToValue = computed<GridSearchSingleValue>({
	get: () => rangeValue.value.to,
	set: (nextValue) => {
		rangeValue.value = {
			...rangeValue.value,
			to: nextValue,
		};
	},
});

const textValue = computed<string>({
	get: () => typeof value.value === "string" ? value.value : "",
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const numberValue = computed<number | null>({
	get: () => typeof value.value === "number" ? value.value : null,
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const rangeNumberFromValue = computed<number | null>({
	get: () => typeof rangeFromValue.value === "number" ? rangeFromValue.value : null,
	set: (nextValue) => {
		rangeFromValue.value = nextValue;
	},
});

const rangeNumberToValue = computed<number | null>({
	get: () => typeof rangeToValue.value === "number" ? rangeToValue.value : null,
	set: (nextValue) => {
		rangeToValue.value = nextValue;
	},
});

const referenceValue = computed<ReferenceValue<ReferenceKeys> | null>({
	get: () => {
		if (
			typeof value.value === "object"
			&& value.value !== null
			&& "keys" in value.value
			&& "descr" in value.value
		) {
			return value.value as ReferenceValue<ReferenceKeys>;
		}

		return null;
	},
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const toDateOrNull = (nextValue: GridSearchSingleValue): Date | null => {
	if (nextValue instanceof Date) {
		return Number.isNaN(nextValue.getTime()) ? null : nextValue;
	}

	if (typeof nextValue === "string" && nextValue !== "") {
		const parsed = new Date(nextValue);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	return null;
};

const dateValue = computed<Date | null>({
	get: () => toDateOrNull(value.value as GridSearchSingleValue),
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const rangeDateFromValue = computed<Date | null>({
	get: () => toDateOrNull(rangeFromValue.value),
	set: (nextValue) => {
		rangeFromValue.value = nextValue;
	},
});

const rangeDateToValue = computed<Date | null>({
	get: () => toDateOrNull(rangeToValue.value),
	set: (nextValue) => {
		rangeToValue.value = nextValue;
	},
});

const boolValue = computed<boolean>({
	get: () => value.value === true,
	set: (nextValue) => {
		value.value = nextValue;
	},
});

const cancelScheduledFocus = (): void => {
	if (focusFrame !== null) {
		window.cancelAnimationFrame(focusFrame);
		focusFrame = null;
	}

	if (focusTimeout !== null) {
		window.clearTimeout(focusTimeout);
		focusTimeout = null;
	}

	if (secondFocusTimeout !== null) {
		window.clearTimeout(secondFocusTimeout);
		secondFocusTimeout = null;
	}
};

const focusValueInputNow = (): void => {
	if (!props.visible) {
		return;
	}

	const root = valueControlRoot.value;
	if (root === null) {
		return;
	}

	const focusable = root.querySelector<HTMLElement>(
		"input:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
	);

	focusable?.focus({ preventScroll: true });

	if (focusable instanceof HTMLInputElement || focusable instanceof HTMLTextAreaElement) {
		const caretPosition = focusable.value.length;
		focusable.setSelectionRange(caretPosition, caretPosition);
	}
};

const scheduleValueInputFocus = async (): Promise<void> => {
	cancelScheduledFocus();
	await nextTick();

	if (!props.visible) {
		return;
	}

	focusFrame = window.requestAnimationFrame(() => {
		focusFrame = null;

		focusTimeout = window.setTimeout(() => {
			focusTimeout = null;
			focusValueInputNow();

			secondFocusTimeout = window.setTimeout(() => {
				secondFocusTimeout = null;
				focusValueInputNow();
			}, 30);
		}, 0);
	});
};

const handleDialogShow = (): void => {
	if (
		!props.criterion
		&& props.initialValue !== null
		&& props.initialValue !== undefined
	) {
		if (currentColumn.value?.dataType === "string") {
			value.value = props.initialValue;
		} else if (currentColumn.value?.dataType === "reference") {
			value.value = {
				keys: null,
				descr: props.initialValue,
			};
		}
	}

	dialogOpening.value = false;
	void scheduleValueInputFocus();
};

const closeDialog = (): void => {
	visibleModel.value = false;
};

const handleCloseButtonFocus = (): void => {
	void scheduleValueInputFocus();
};

const setSearchValue = (nextValue: unknown): void => {
	value.value = nextValue as GridSearchValue;
};

const resetForColumn = (): void => {
	const column = currentColumn.value;

	if (!column) {
		operation.value = "exact";
		value.value = null;
		return;
	}

	operation.value = column.operations.includes(operation.value)
		? operation.value
		: defaultOperationForColumn(column);

	if (props.criterion?.field === column.field) {
		return;
	}

	if (operation.value === "range") {
		value.value = {
			from: null,
			to: null,
		};
	} else if (column.dataType === "boolean") {
		value.value = true;
	} else {
		value.value = null;
	}
};

const setOperation = (nextOperation: GridSearchOperation): void => {
	if (operation.value === nextOperation) {
		return;
	}

	operation.value = nextOperation;

	if (nextOperation === "range") {
		value.value = {
			from: null,
			to: null,
		};
		return;
	}

	if (isSearchRangeValue(value.value)) {
		value.value = currentColumn.value?.dataType === "boolean" ? true : null;
	}
};

watch(
	() => props.visible,
	(isVisible) => {
		if (!isVisible) {
			dialogOpening.value = false;
			cancelScheduledFocus();
			return;
		}

		dialogOpening.value = true;

		if (props.criterion) {
			selectedField.value = props.criterion.field;
			operation.value = props.criterion.operation;
			value.value = props.criterion.value;
			return;
		}

		const initialFieldExists = props.initialField
			? props.columns.some((column) => column.field === props.initialField)
			: false;

		selectedField.value = initialFieldExists
			? props.initialField ?? null
			: props.columns[0]?.field ?? null;
		operation.value = defaultOperationForColumn(currentColumn.value);
		if (currentColumn.value?.dataType === "string") {
			value.value = props.initialValue ?? null;
		} else if (
			currentColumn.value?.dataType === "reference"
			&& props.initialValue !== null
			&& props.initialValue !== undefined
		) {
			value.value = {
				keys: null,
				descr: props.initialValue,
			};
		} else {
			value.value = currentColumn.value?.dataType === "boolean" ? true : null;
		}
	},
);

watch(selectedField, () => {
	if (dialogOpening.value) {
		return;
	}

	resetForColumn();

	if (props.visible) {
		void scheduleValueInputFocus();
	}
});

watch(operation, () => {
	if (props.visible && !dialogOpening.value) {
		void scheduleValueInputFocus();
	}
});

const canApply = computed(() => {
	return selectedField.value !== null && !searchValueIsEmpty(value.value);
});

const applySearch = (): void => {
	if (!selectedField.value || !canApply.value) {
		return;
	}

	emit("apply", {
		field: selectedField.value,
		operation: operation.value,
		value: value.value,
	});
	visibleModel.value = false;
};

const submitOnEnter = (event: KeyboardEvent): void => {
	if (event.isComposing) {
		return;
	}

	event.preventDefault();
	applySearch();
};

onBeforeUnmount(() => {
	cancelScheduledFocus();
});
</script>

<template>
	<Dialog
		v-model:visible="visibleModel"
		modal
		:closable="false"
		:style="{ width: '34rem' }"
		class="crud-grid-search-dialog"
		@show="handleDialogShow"
	>
		<template #header>
			<div class="crud-grid-search-dialog-header">
				<span class="crud-grid-search-dialog-title">
					{{ t("Grid.search.title") }}
				</span>
				<button
					type="button"
					class="crud-grid-search-dialog-close p-link"
					tabindex="-1"
					:aria-label="t('Grid.search.cancel')"
					@mousedown.prevent
					@focus="handleCloseButtonFocus"
					@click="closeDialog"
				>
					<span aria-hidden="true">×</span>
				</button>
			</div>
		</template>
		<form
			:id="searchFormId"
			data-collection-ignore-dirty="true"
			class="crud-grid-search-form"
			@submit.prevent="applySearch"
		>
			<div class="crud-grid-search-field">
				<label :for="columnInputId">
					{{ t("Grid.search.column") }}
				</label>
				<Select
					:id="columnInputId"
					v-model="selectedField"
					:options="columnOptions"
					optionLabel="label"
					optionValue="value"
					class="crud-grid-search-control"
				/>
			</div>

			<div
				v-if="operationOptions.length > 1"
				class="crud-grid-search-operations"
			>
				<span>{{ t("Grid.search.operation") }}</span>
				<div class="crud-grid-search-operation-list">
					<label
						v-for="option in operationOptions"
						:key="option.value"
						class="crud-grid-search-inline-control"
					>
						<input
							type="radio"
							:name="operationGroupName"
							:checked="operation === option.value"
							@change="setOperation(option.value)"
						/>
						<span>{{ option.label }}</span>
					</label>
				</div>
			</div>

			<div
				v-if="currentColumn"
				class="crud-grid-search-field"
			>
				<label :for="valueInputId">
					{{ operation === "range" ? t("Grid.search.range") : t("Grid.search.value") }}
				</label>

				<div
					ref="valueControlRoot"
					class="crud-grid-search-control"
					@keydown.enter.exact="submitOnEnter"
				>
					<component
						:is="currentColumn.searchComponent"
						v-if="currentColumn.searchComponent"
						:id="valueInputId"
						:modelValue="value"
						v-bind="currentColumn.searchComponentProps"
						@update:modelValue="setSearchValue"
					/>

					<div
						v-else-if="operation === 'range' && currentColumn.dataType === 'number'"
						class="crud-grid-search-range"
					>
						<InputNumber
							v-model="rangeNumberFromValue"
							:placeholder="t('Grid.search.from')"
							class="crud-grid-search-control"
						/>
						<InputNumber
							v-model="rangeNumberToValue"
							:placeholder="t('Grid.search.to')"
							class="crud-grid-search-control"
						/>
					</div>

					<div
						v-else-if="operation === 'range' && currentColumn.dataType === 'date'"
						class="crud-grid-search-range"
					>
						<DatePicker
							v-model="rangeDateFromValue"
							:placeholder="t('Grid.search.from')"
							class="crud-grid-search-control"
							showIcon
						/>
						<DatePicker
							v-model="rangeDateToValue"
							:placeholder="t('Grid.search.to')"
							class="crud-grid-search-control"
							showIcon
						/>
					</div>

					<InputText
						v-else-if="currentColumn.dataType === 'string'"
						:id="valueInputId"
						v-model="textValue"
						class="crud-grid-search-control"
					/>

					<InputNumber
						v-else-if="currentColumn.dataType === 'number'"
						v-model="numberValue"
						:inputId="valueInputId"
						class="crud-grid-search-control"
					/>

					<div
						v-else-if="currentColumn.dataType === 'boolean'"
						class="crud-grid-search-inline-control"
					>
						<Checkbox
							v-model="boolValue"
							:inputId="valueInputId"
							binary
						/>
						<label :for="valueInputId">
							{{ boolValue ? t("Grid.boolean.yes") : t("Grid.boolean.no") }}
						</label>
					</div>

					<DatePicker
						v-else-if="currentColumn.dataType === 'date'"
						v-model="dateValue"
						:inputId="valueInputId"
						class="crud-grid-search-control"
						showIcon
					/>

					<ReferenceInput
						v-else-if="currentColumn.dataType === 'reference' && currentColumn.referenceAutocomplete"
						:id="valueInputId"
						class="crud-grid-search-reference-input crud-grid-search-control"
						v-model="referenceValue"
						:autocomplete="currentColumn.referenceAutocomplete"
						:openAction="currentColumn.referenceOpenAction"
						:selectAction="currentColumn.referenceSelectAction"
						:showOpen="Boolean(currentColumn.referenceOpenAction)"
						:showSelect="Boolean(currentColumn.referenceSelectAction)"
						:openTitle="t('Grid.commands.edit')"
						:selectTitle="t('Grid.commands.search')"
						:clearTitle="t('Grid.search.clearValue')"
					/>

					<InputText
						v-else
						:id="valueInputId"
						v-model="textValue"
						class="crud-grid-search-control"
					/>
				</div>
			</div>
		</form>

		<template #footer>
			<Button
				type="button"
				:label="t('Grid.search.cancel')"
				severity="secondary"
				outlined
				@click="closeDialog"
			/>
			<Button
				type="submit"
				:form="searchFormId"
				:label="t('Grid.search.apply')"
				:disabled="!canApply"
			/>
		</template>
	</Dialog>
</template>

<style scoped>
.crud-grid-search-dialog-header {
	align-items: center;
	display: flex;
	gap: 0.75rem;
	justify-content: space-between;
	width: 100%;
}

.crud-grid-search-form {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.crud-grid-search-field {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.crud-grid-search-operations {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.crud-grid-search-operation-list {
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
}

.crud-grid-search-inline-control {
	align-items: center;
	display: flex;
	gap: 0.5rem;
}

.crud-grid-search-range {
	display: grid;
	gap: 0.75rem;
	grid-template-columns: repeat(2, minmax(0, 1fr));
}

.crud-grid-search-control {
	width: 100%;
}

:global(.crud-grid-search-dialog .p-dialog-header) {
	min-height: 0;
	padding: 0.25rem 0.75rem;
}

.crud-grid-search-dialog-title {
	font-size: 0.8125rem;
	line-height: 1rem;
}

.crud-grid-search-dialog-close {
	align-items: center;
	border-radius: 50%;
	display: inline-flex;
	font-size: 1.25rem;
	height: 2rem;
	justify-content: center;
	line-height: 1;
	width: 2rem;
}

.crud-grid-search-dialog-close:focus {
	outline: none;
}

:deep(.crud-grid-search-reference-input) {
	min-width: 0;
	width: 100%;
}

:deep(.crud-grid-search-reference-input .crud-reference-input-autocomplete) {
	min-width: 18rem;
}
</style>
