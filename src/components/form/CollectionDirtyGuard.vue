<script setup lang="ts">
import {
	computed,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
	useRoute,
	useRouter,
} from "vue-router";

import Button from "primevue/button";
import Dialog from "primevue/dialog";

import {
	collectionFormDirtyGuardAllowNextNavigationEvent,
	collectionFormDirtyGuardMarkCleanEvent,
	collectionFormDirtyGuardMarkDirtyEvent,
	collectionFormSubmitErrorEvent,
	collectionFormSubmitSuccessEvent,
} from "../../composables/form/events";

type RouterGuardUnregister = () => void;

const props = withDefaults(defineProps<{
	enabled?: boolean;
	/**
	 * Dirty detection is intentionally DOM-based so existing form components do not
	 * have to expose their local refs. Keep this selector narrow in applications
	 * that contain unrelated forms inside edit pages.
	 */
	formSelector?: string;
	beforeUnload?: boolean;
}>(), {
	enabled: true,
	formSelector: "form:not([data-collection-ignore-dirty])",
	beforeUnload: true,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const rootEl = ref<HTMLElement | null>(null);
const dirty = ref(false);
const confirmVisible = ref(false);
const pendingRoute = ref<string | null>(null);
const allowNextNavigation = ref(false);
const saveRequested = ref(false);
let unregisterGuard: RouterGuardUnregister | null = null;

const active = computed(() => props.enabled);

const markClean = (): void => {
	dirty.value = false;
};

const markDirty = (): void => {
	if (!active.value) {
		return;
	}

	dirty.value = true;
};

const eventTargetBelongsToGuardedForm = (
	target: EventTarget | null,
): boolean => {
	if (!(target instanceof Element) || rootEl.value === null) {
		return false;
	}

	return rootEl.value.contains(target)
		&& target.closest(props.formSelector) !== null;
};

const onFieldMutation = (event: Event): void => {
	if (!eventTargetBelongsToGuardedForm(event.target)) {
		return;
	}

	markDirty();
};

const guardedForm = (): HTMLFormElement | null => {
	const form = rootEl.value?.querySelector(props.formSelector);
	return form instanceof HTMLFormElement ? form : null;
};

const closeDialog = (): void => {
	confirmVisible.value = false;
};

const navigateToPendingRoute = async (): Promise<void> => {
	const to = pendingRoute.value;
	pendingRoute.value = null;

	if (to === null) {
		return;
	}

	allowNextNavigation.value = true;
	await router.push(to);
};

const saveAndClose = (): void => {
	const form = guardedForm();
	if (form === null) {
		markClean();
		closeDialog();
		void navigateToPendingRoute();
		return;
	}

	saveRequested.value = true;
	closeDialog();
	form.requestSubmit();
};

const discardAndClose = async (): Promise<void> => {
	markClean();
	closeDialog();
	await navigateToPendingRoute();
};

const cancelClose = (): void => {
	saveRequested.value = false;
	pendingRoute.value = null;
	closeDialog();
};

const onSubmitSuccess = (): void => {
	markClean();

	if (!saveRequested.value) {
		return;
	}

	saveRequested.value = false;
	allowNextNavigation.value = true;
};

const onSubmitError = (): void => {
	saveRequested.value = false;
};

const onExternalMarkClean = (): void => {
	markClean();
};

const onExternalMarkDirty = (): void => {
	markDirty();
};

const onExternalAllowNextNavigation = (): void => {
	allowNextNavigation.value = true;
};

const onBeforeUnload = (event: BeforeUnloadEvent): void => {
	if (!props.beforeUnload || !active.value || !dirty.value) {
		return;
	}

	event.preventDefault();
	event.returnValue = "";
};

watch(
	() => [route.fullPath, active.value] as const,
	() => {
		if (!active.value) {
			markClean();
		}
	},
);

onMounted(() => {
	rootEl.value?.addEventListener("input", onFieldMutation, true);
	rootEl.value?.addEventListener("change", onFieldMutation, true);
	window.addEventListener(collectionFormSubmitSuccessEvent, onSubmitSuccess);
	window.addEventListener(collectionFormSubmitErrorEvent, onSubmitError);
	window.addEventListener(collectionFormDirtyGuardMarkCleanEvent, onExternalMarkClean);
	window.addEventListener(collectionFormDirtyGuardMarkDirtyEvent, onExternalMarkDirty);
	window.addEventListener(collectionFormDirtyGuardAllowNextNavigationEvent, onExternalAllowNextNavigation);
	window.addEventListener("beforeunload", onBeforeUnload);

	unregisterGuard = router.beforeEach((to) => {
		if (allowNextNavigation.value) {
			allowNextNavigation.value = false;
			return true;
		}

		if (!active.value || !dirty.value) {
			return true;
		}

		pendingRoute.value = to.fullPath;
		confirmVisible.value = true;
		return false;
	});
});

onBeforeUnmount(() => {
	rootEl.value?.removeEventListener("input", onFieldMutation, true);
	rootEl.value?.removeEventListener("change", onFieldMutation, true);
	window.removeEventListener(collectionFormSubmitSuccessEvent, onSubmitSuccess);
	window.removeEventListener(collectionFormSubmitErrorEvent, onSubmitError);
	window.removeEventListener(collectionFormDirtyGuardMarkCleanEvent, onExternalMarkClean);
	window.removeEventListener(collectionFormDirtyGuardMarkDirtyEvent, onExternalMarkDirty);
	window.removeEventListener(collectionFormDirtyGuardAllowNextNavigationEvent, onExternalAllowNextNavigation);
	window.removeEventListener("beforeunload", onBeforeUnload);
	unregisterGuard?.();
});

defineExpose({
	dirty,
	markClean,
	markDirty,
});
</script>

<template>
	<div ref="rootEl">
		<slot />

		<Dialog
			v-model:visible="confirmVisible"
			:header="t('Grid.dirtyConfirm.title')"
			:style="{ width: '32rem' }"
			modal
		>
			<p class="collection-dirty-guard-message">
				{{ t("Grid.dirtyConfirm.message") }}
			</p>

			<template #footer>
				<div class="collection-dirty-guard-actions">
					<Button
						:label="t('Grid.dirtyConfirm.discard')"
						severity="secondary"
						outlined
						@click="discardAndClose"
					/>
					<Button
						:label="t('Grid.dirtyConfirm.cancel')"
						severity="secondary"
						@click="cancelClose"
					/>
					<Button
						:label="t('Grid.dirtyConfirm.save')"
						icon="pi pi-check"
						@click="saveAndClose"
					/>
				</div>
			</template>
		</Dialog>
	</div>
</template>

<style scoped>
.collection-dirty-guard-message {
	color: var(--p-text-muted-color, rgb(55 65 81));
	font-size: 0.875rem;
	line-height: 1.5rem;
	margin: 0;
}

.collection-dirty-guard-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	justify-content: flex-end;
}
</style>
