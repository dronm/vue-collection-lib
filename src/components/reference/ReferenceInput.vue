<script setup lang="ts" generic="TRow extends ReferenceRow, TKeys extends ReferenceKeys">
import {
	computed,
	onBeforeUnmount,
	ref,
	shallowRef,
	watch,
} from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import AutoComplete from "primevue/autocomplete";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import CollectionCreateForm from "../form/CollectionCreateForm.vue";

import type {
	ReferenceAutocompleteConfig,
	ReferenceCreateAction,
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
import {
	createReferenceSelectionToken,
	isReferenceSelectionMessage,
	REFERENCE_SELECTION_QUERY_PARAM,
	referenceSelectionChannelName,
} from "../../utils/referenceSelection";
import {
	createReferenceCreationToken,
	isReferenceCreationMessage,
	REFERENCE_CREATION_QUERY_PARAM,
	referenceCreationChannelName,
} from "../../utils/referenceCreation";
import {
	clearReferenceCreationDefaults,
	prepareReferenceCreationDefaults,
} from "../../utils/referenceCreationDefaults";
import type { CollectionDefinition } from "../../types/collectionDefinition";
import type { GridCreateContext } from "../crudGrid/types";
import type { FormErrorsController } from "../../types/formErrors";
import { collectionReferenceChangeEvent } from "../../composables/form/events";

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
	showCreate?: boolean;
	openAction?: ReferenceRouteAction<ReferenceValue<TKeys>>;
	selectAction?: ReferenceSelectAction;
	createAction?: ReferenceCreateAction<TRow>;
	openTitle?: string;
	selectTitle?: string;
	clearTitle?: string;
	createTitle?: string;
}>(), {
	modelValue: null,
	disabled: false,
	required: false,
	invalid: false,
	showOpen: true,
	showSelect: true,
	showClear: true,
	showCreate: true,
	openTitle: "Open",
	selectTitle: "Select",
	clearTitle: "Clear",
});

const emit = defineEmits<{
	"update:modelValue": [value: ReferenceValue<TKeys> | null];
	select: [value: ReferenceValue<TKeys>, row: TRow];
	open: [value: ReferenceValue<TKeys>];
	selectRequest: [];
	createRequest: [];
	clear: [];
}>();

const slots = defineSlots<{
	option?: (props: {
		row: TRow;
		value: ReferenceValue<TKeys>;
	}) => unknown;
	"input-prefix"?: (props: {
		modelValue: ReferenceValue<TKeys> | null;
		disabled: boolean;
	}) => unknown;
}>();

const router = useRouter();
const { t } = useI18n();
const rootEl = ref<HTMLElement | null>(null);
const suggestions = shallowRef<ReferenceOption[]>([]);
const loading = shallowRef(false);
const searchError = shallowRef<string | null>(null);
const creationError = shallowRef<string | null>(null);
const creationVisible = ref(false);
const creationPending = ref(false);
const creationCollection = shallowRef<CollectionDefinition<any, any, any, any, any> | null>(null);
const creationContext = shallowRef<GridCreateContext | undefined>(undefined);
const creationDefaultValues = shallowRef<Record<string, unknown> | undefined>(undefined);
const typedDescription = ref("");
const restoredDescription = shallowRef<string | null>(null);
let pendingModelEcho: { keys: string; description: string | undefined } | undefined;
const inputModelValue = computed(() => {
	return restoredDescription.value === null
		? props.modelValue
		: { keys: null, descr: restoredDescription.value };
});
const canClear = computed(() => {
	return !props.disabled && Boolean(
		props.modelValue
		|| (props.createAction?.prefill && typedDescription.value.trim() !== ""),
	);
});
const activeCreateAction = shallowRef<ReferenceCreateAction<TRow> | null>(null);
const receivedCreatedDetail = shallowRef<{ row: object; key: unknown } | null>(null);
const creationForm = ref<{
	submitting: boolean;
	errors: FormErrorsController;
} | null>(null);
const showCreateButton = computed(() => props.showCreate && Boolean(props.createAction));
const canCreate = computed(() => {
	return showCreateButton.value
		&& !props.disabled
		&& !props.createAction?.disabled
		&& !creationPending.value
		&& !creationVisible.value
		&& receivedCreatedDetail.value === null;
});
const creationTitle = computed(() => {
	return activeCreateAction.value?.title ?? (
		creationCollection.value
			? `${t('Reference.create.title')}: ${t(creationCollection.value.titleKey)}`
			: t('Reference.create.title')
	);
});

const inputInvalid = computed(() => {
	return props.invalid || Boolean(props.error);
});

const hasActionButtons = computed(() => {
	return props.showOpen || props.showSelect || props.showClear || showCreateButton.value;
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

const resetTypedDescription = (): void => {
	typedDescription.value = "";
	restoredDescription.value = null;
};

const captureTypedDescription = (event: Event): void => {
	const input = event.target;
	if (
		!(input instanceof HTMLInputElement)
		|| !input.closest(".crud-reference-input-autocomplete")
	) {
		return;
	}
	// Capture before AutoComplete can reject unmatched input on change. A later
	// null model is also emitted by forceSelection and must not erase this text.
	typedDescription.value = input.value;
	restoredDescription.value = null;
	abandonCreatedSelection();
};

const restoreTypedDescription = (): void => {
	if (
		props.createAction?.prefill
		&& typedDescription.value.trim() !== ""
		&& !props.modelValue?.keys
	) {
		restoredDescription.value = typedDescription.value;
	}
};

const emitModelValue = (value: ReferenceValue<TKeys> | null): void => {
	pendingModelEcho = {
		keys: JSON.stringify(value?.keys ?? null),
		description: value?.descr,
	};
	emit("update:modelValue", value);
};

const updateModelValue = (value: unknown): void => {
	abandonCreatedSelection();
	restoredDescription.value = null;
	if (value === "") {
		resetTypedDescription();
	}
	if (value === null || value === undefined || value === "") {
		emitModelValue(null);
		return;
	}

	if (typeof value === "string") {
		typedDescription.value = value;
		emitModelValue({
			keys: null,
			descr: value,
		});
		return;
	}

	if (isReferenceValue<TKeys>(value)) {
		if ("__row" in value) {
			emitModelValue(stripOption(value as ReferenceOption));
			return;
		}

		emitModelValue(value);
	}
};

const selectOption = (event: { value: ReferenceOption; fromCreation?: boolean }): void => {
	if (!event.fromCreation) {
		abandonCreatedSelection();
	}
	resetTypedDescription();
	const selected = stripOption(event.value);
	emitModelValue(selected);
	emit("select", selected, event.value.__row);
	rootEl.value?.dispatchEvent(new CustomEvent(collectionReferenceChangeEvent, {
		bubbles: true,
	}));
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

let selectionChannel: BroadcastChannel | null = null;
let selectionToken: string | null = null;

const onSelectionWindowMessage = (event: MessageEvent<unknown>): void => {
	if (
		typeof window === "undefined"
		|| event.origin !== window.location.origin
		|| !isReferenceSelectionMessage(event.data)
		|| event.data.token !== selectionToken
	) {
		return;
	}

	const option = optionFromRow(event.data.row as TRow);
	selectOption({ value: option });
	closeSelectionSession();
};

const closeSelectionSession = (): void => {
	selectionChannel?.close();
	selectionChannel = null;
	selectionToken = null;

	if (typeof window !== "undefined") {
		window.removeEventListener("message", onSelectionWindowMessage);
	}
};

const acceptSelectionRow = (row: TRow): void => {
	const option = optionFromRow(row);
	selectOption({ value: option });
	closeSelectionSession();
};

const requestSelect = async (): Promise<void> => {
	if (!canSelect.value) {
		return;
	}
	abandonCreatedSelection();

	emit("selectRequest");

	const routeValue = typeof props.selectAction?.route === "function"
		? props.selectAction.route()
		: props.selectAction?.route;

	if (!routeValue) {
		return;
	}

	if (props.selectAction?.target !== "_blank" || typeof window === "undefined") {
		await openRoute(routeValue, props.selectAction?.target);
		return;
	}

	closeSelectionSession();
	selectionToken = createReferenceSelectionToken();

	const resolved = router.resolve(routeValue);
	const href = router.resolve({
		path: resolved.path,
		query: {
			...resolved.query,
			[REFERENCE_SELECTION_QUERY_PARAM]: selectionToken,
		},
		hash: resolved.hash,
	}).href;

	if (typeof BroadcastChannel !== "undefined") {
		selectionChannel = new BroadcastChannel(
			referenceSelectionChannelName(selectionToken),
		);
		selectionChannel.onmessage = (event: MessageEvent<unknown>) => {
			if (
				!isReferenceSelectionMessage(event.data)
				|| event.data.token !== selectionToken
			) {
				return;
			}

			acceptSelectionRow(event.data.row as TRow);
		};
	}

	window.addEventListener("message", onSelectionWindowMessage);

	// The picker is an internal same-origin route. Keep window.opener available as
	// a fallback transport; BroadcastChannel remains the primary transport.
	const popup = window.open(href, "_blank");

	if (popup === null) {
		closeSelectionSession();
	}
};

let creationChannel: BroadcastChannel | null = null;
let creationToken: string | null = null;
let creationWindowPoll: ReturnType<typeof setInterval> | null = null;
let creationOriginKeys: string | null = null;

const closeCreationSession = (): void => {
	creationChannel?.close();
	creationChannel = null;
	if (creationToken !== null) {
		clearReferenceCreationDefaults(creationToken);
	}
	creationToken = null;
	creationOriginKeys = null;
	creationPending.value = false;
	if (creationWindowPoll !== null) {
		clearInterval(creationWindowPoll);
		creationWindowPoll = null;
	}
	if (typeof window !== "undefined") {
		window.removeEventListener("message", onCreationWindowMessage);
	}
};

const abandonCreatedSelection = (): void => {
	closeCreationSession();
	receivedCreatedDetail.value = null;
	creationError.value = null;
	activeCreateAction.value = null;
};

const applyCreatedDetail = (detail: object, createdKey: unknown): void => {
	if (props.disabled || props.createAction?.disabled) {
		throw new Error(t("Reference.create.inputDisabled"));
	}
	const action = activeCreateAction.value ?? props.createAction;
	const row = action?.rowFromDetail ? action.rowFromDetail(detail) : detail as TRow;
	if (typeof row !== "object" || row === null || Array.isArray(row)) {
		throw new Error(t("Reference.create.invalidResult"));
	}
	const option = optionFromRow(row);
	const savedKeys = action?.keysFromCreated
		? action.keysFromCreated(createdKey)
		: typeof createdKey === "object" && createdKey !== null && !Array.isArray(createdKey)
			? createdKey as ReferenceKeys
			: props.autocomplete.keyFields.length === 1
				? { [props.autocomplete.keyFields[0]!]: createdKey }
				: null;
	if (
		savedKeys === null
		|| typeof savedKeys !== "object"
		|| props.autocomplete.keyFields.length === 0
		|| props.autocomplete.keyFields.some((field) => {
			const key = option.keys?.[field];
			return key === null || key === undefined || key === ""
				|| !["string", "number", "boolean"].includes(typeof key)
				|| key !== savedKeys?.[field];
		})
	) {
		throw new Error(t("Reference.create.invalidResult"));
	}
	selectOption({ value: option, fromCreation: true });
	creationError.value = null;
	receivedCreatedDetail.value = null;
};

const acceptCreatedDialog = (detail: object, key: unknown): void => {
	try {
		applyCreatedDetail(detail, key);
		creationVisible.value = false;
	} catch (err: unknown) {
		creationForm.value?.errors.setFromError(err);
	}
};

const acceptCreatedPage = (detail: object, key: unknown): void => {
	receivedCreatedDetail.value = { row: detail, key };
	try {
		applyCreatedDetail(detail, key);
	} catch (err: unknown) {
		creationError.value = errorText(err);
	} finally {
		closeCreationSession();
	}
};

const onCreationWindowMessage = (event: MessageEvent<unknown>): void => {
	if (
		typeof window === "undefined"
		|| event.origin !== window.location.origin
		|| !isReferenceCreationMessage(event.data)
		|| event.data.token !== creationToken
	) {
		return;
	}
	acceptCreatedPage(event.data.row, event.data.key);
};

const retryCreatedSelection = (): void => {
	if (receivedCreatedDetail.value !== null) {
		acceptCreatedPage(receivedCreatedDetail.value.row, receivedCreatedDetail.value.key);
	}
};

const requestCreate = (): void => {
	if (!canCreate.value || !props.createAction) {
		return;
	}

	emit("createRequest");
	closeSelectionSession();
	closeCreationSession();
	creationError.value = null;
	activeCreateAction.value = props.createAction;
	const action = props.createAction;
	try {
		creationDefaultValues.value = undefined;
		if (action.prefill && typedDescription.value.trim() !== "") {
			const values = action.prefill(typedDescription.value);
			if (
				typeof values !== "object"
				|| values === null
				|| Array.isArray(values)
				|| ![Object.prototype, null].includes(Object.getPrototypeOf(values))
			) {
				throw new Error(t("Reference.create.invalidPrefill"));
			}
			creationDefaultValues.value = values;
		}
		if (action.mode === "dialog") {
			creationCollection.value = action.collection();
			creationContext.value = typeof action.context === "function"
				? action.context()
				: action.context;
			creationVisible.value = true;
			return;
		}

		if (typeof window === "undefined") {
			return;
		}
		const routeValue = typeof action.route === "function" ? action.route() : action.route;
		const resolved = router.resolve(routeValue);
		creationToken = createReferenceCreationToken();
		if (creationDefaultValues.value !== undefined) {
			prepareReferenceCreationDefaults(creationToken, creationDefaultValues.value);
		}
		const href = router.resolve({
			path: resolved.path,
			query: {
				...resolved.query,
				[REFERENCE_CREATION_QUERY_PARAM]: creationToken,
			},
			hash: resolved.hash,
		}).href;

		if (typeof BroadcastChannel !== "undefined") {
			try {
				creationChannel = new BroadcastChannel(referenceCreationChannelName(creationToken));
				creationChannel.onmessage = (event: MessageEvent<unknown>) => {
					if (isReferenceCreationMessage(event.data) && event.data.token === creationToken) {
						acceptCreatedPage(event.data.row, event.data.key);
					}
				};
			} catch {
				creationChannel = null;
			}
		}
		window.addEventListener("message", onCreationWindowMessage);
		const popup = window.open(href, "_blank");
		if (popup === null) {
			throw new Error(t("Reference.create.popupBlocked"));
		}
		creationPending.value = true;
		creationOriginKeys = JSON.stringify(props.modelValue?.keys ?? null);
		creationWindowPoll = setInterval(() => {
			if (popup.closed) {
				closeCreationSession();
				restoreTypedDescription();
			}
		}, 500);
	} catch (err: unknown) {
		closeCreationSession();
		creationError.value = errorText(err);
		restoreTypedDescription();
	}
};

watch(creationVisible, (visible) => {
	if (!visible) {
		creationCollection.value = null;
		creationContext.value = undefined;
		creationDefaultValues.value = undefined;
		restoreTypedDescription();
	}
});

watch(() => JSON.stringify(props.modelValue?.keys ?? null), (keys) => {
	if (creationPending.value && keys !== creationOriginKeys) {
		abandonCreatedSelection();
	}
});

watch(() => [props.modelValue, props.modelValue?.descr, JSON.stringify(props.modelValue?.keys ?? null)] as const, ([value]) => {
	const ownUpdate = pendingModelEcho !== undefined
		&& pendingModelEcho.keys === JSON.stringify(value?.keys ?? null)
		&& pendingModelEcho.description === value?.descr;
	pendingModelEcho = undefined;
	if (value?.keys || !ownUpdate) {
		resetTypedDescription();
	}
});

onBeforeUnmount(() => {
	closeSelectionSession();
	closeCreationSession();
});

const clearValue = (): void => {
	abandonCreatedSelection();
	resetTypedDescription();
	emitModelValue(null);
	emit("clear");
};
</script>

<template>
	<div ref="rootEl" class="crud-reference-input">
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
			<div
				class="crud-reference-input-field"
				:class="{ 'crud-reference-input-field--with-prefix': Boolean(slots['input-prefix']) }"
				@input.capture="captureTypedDescription"
			>
				<AutoComplete
					fluid
					:inputId="props.id"
					:modelValue="inputModelValue"
					:suggestions="suggestions"
					optionLabel="descr"
					class="crud-reference-input-autocomplete"
					inputClass="crud-reference-input-autocomplete-input"
					:placeholder="props.placeholder"
					:disabled="props.disabled"
					:required="props.required"
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
						<slot
							name="option"
							:row="option.__row"
							:value="stripOption(option)"
						>
							<span>{{ option.descr }}</span>
						</slot>
					</template>
				</AutoComplete>

				<div
					v-if="slots['input-prefix']"
					class="crud-reference-input-prefix"
				>
					<slot
						name="input-prefix"
						:modelValue="props.modelValue"
						:disabled="props.disabled"
					/>
				</div>
			</div>

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
				v-if="showCreateButton"
				type="button"
				class="crud-reference-input-action"
				icon="pi pi-plus"
				severity="secondary"
				outlined
				:disabled="!canCreate"
				:title="props.createTitle ?? t('Reference.create.title')"
				:aria-label="props.createTitle ?? t('Reference.create.title')"
				@click="requestCreate"
			/>

			<Button
				v-if="props.showClear"
				class="crud-reference-input-action"
				icon="pi pi-times"
				severity="secondary"
				outlined
				:disabled="!canClear"
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
			v-if="creationError"
			class="crud-reference-input-error"
			role="alert"
		>
			{{ creationError }}
		</small>
		<Button
			v-if="receivedCreatedDetail"
			type="button"
			:label="t('Reference.create.retrySelection')"
			:disabled="props.disabled || props.createAction?.disabled"
			@click="retryCreatedSelection"
		/>
		<Dialog
			v-model:visible="creationVisible"
			:header="creationTitle"
			:style="{ width: '36rem', maxWidth: '95vw' }"
			:closable="!creationForm?.submitting"
			:closeOnEscape="!creationForm?.submitting"
			modal
		>
			<CollectionCreateForm
				v-if="creationVisible && creationCollection"
				ref="creationForm"
				:collection="creationCollection"
				:context="creationContext"
				:defaultValues="creationDefaultValues"
				@created="acceptCreatedDialog"
				@cancel="creationVisible = false"
			/>
		</Dialog>

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
	min-width: 0;
	width: 100%;
}

.crud-reference-input-field {
	display: flex;
	flex: 1 1 0%;
	min-width: 0;
	position: relative;
	width: 0;
}

.crud-reference-input-prefix {
	align-items: center;
	display: flex;
	height: 100%;
	justify-content: center;
	left: 0.5rem;
	position: absolute;
	top: 0;
	width: var(--crud-reference-input-prefix-width, 2rem);
	z-index: 1;
}

.crud-reference-input-field--with-prefix
	:deep(.crud-reference-input-autocomplete-input) {
	/* Keep prefix space when an application overrides compact input padding. */
	padding-left: calc(var(--crud-reference-input-prefix-width, 2rem) + 1rem) !important;
}

:deep(.crud-reference-input-autocomplete) {
	flex: 1 1 0%;
	min-width: 0;
	width: 0;
}

:deep(.crud-reference-input-autocomplete .p-autocomplete-input),
:deep(.crud-reference-input-autocomplete-input) {
	min-width: 0;
	width: 100%;
}

.crud-reference-input-action,
:deep(.crud-reference-input-action.p-button) {
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
	margin-left: -1px;
}

:deep(.crud-reference-input-action.p-button:last-child) {
	border-bottom-right-radius: var(--p-button-border-radius, 6px);
	border-top-right-radius: var(--p-button-border-radius, 6px);
}
</style>
