import {
	computed,
	onMounted,
	ref,
	shallowRef,
	type Ref,
} from "vue";
import {
	useRoute,
	useRouter,
	type RouteLocationNormalizedLoaded,
	type RouteLocationRaw,
	type RouteRecordName,
} from "vue-router";
import type * as v from "valibot";

import type { CollectionAlterResult } from "../../types/collection";
import type { FormMutationFieldConfig } from "../../types/formMutation";
import type { CollectionFormMode } from "../../types/formSubmit";
import { useReferenceCreation } from "../useReferenceCreation";
import { useCollectionFormSubmit } from "./useCollectionFormSubmit";
import { useFormErrors } from "./useFormErrors";

export interface UseCollectionEditPageOptions<
	TModel extends object,
	TKey,
	TCreate extends object,
	TUpdate extends object,
	TDetail extends object,
> {
	api: {
		detail: (key: TKey) => Promise<TDetail>;
		create: (model: TCreate) => Promise<TKey>;
		update: (key: TKey, model: TUpdate) => Promise<CollectionAlterResult>;
	};
	createRouteName: RouteRecordName;
	listRoute: RouteLocationRaw | (() => RouteLocationRaw);
	keyFromRoute: (route: RouteLocationNormalizedLoaded) => TKey;
	copyKeyFromRoute?: (route: RouteLocationNormalizedLoaded) => TKey | null;
	createModel: () => TModel;
	fromDetail?: (detail: TDetail) => TModel;
	copyModel?: (detail: TDetail) => TModel;
	fields: FormMutationFieldConfig<TModel, TCreate | TUpdate>[];
	createSchema?: v.GenericSchema<TCreate>;
	updateSchema?: v.GenericSchema<TUpdate>;
	success?:
		| { mode: "back" }
		| { mode: "stay"; editRoute: (key: TKey) => RouteLocationRaw };
}

export const useCollectionEditPage = <
	TModel extends object,
	TKey,
	TCreate extends object,
	TUpdate extends object,
	TDetail extends object = TModel,
>(
	options: UseCollectionEditPageOptions<TModel, TKey, TCreate, TUpdate, TDetail>,
) => {
	const route = useRoute();
	const router = useRouter();
	const loading = ref(false);
	const model = ref(options.createModel()) as Ref<TModel>;
	const errors = useFormErrors();
	const referenceCreation = useReferenceCreation();
	const createdKey = shallowRef<TKey | null>(null);
	const completingReferenceCreation = ref(false);
	const isCreateRoute = computed(() => route.name === options.createRouteName);
	const mode = computed<CollectionFormMode>(() => {
		if (!isCreateRoute.value) {
			return "edit";
		}

		return options.copyKeyFromRoute?.(route)
			? "copy"
			: "create";
	});
	const key = computed(() => options.keyFromRoute(route));

	const goBack = async (): Promise<void> => {
		if (referenceCreation.creationMode.value) {
			referenceCreation.cancel();
			return;
		}

		const target = typeof options.listRoute === "function"
			? options.listRoute()
			: options.listRoute;
		await router.push(target);
	};

	const returnCreatedReference = async (savedKey: TKey): Promise<void> => {
		completingReferenceCreation.value = true;
		try {
			const detail = await options.api.detail(savedKey);
			if (!referenceCreation.complete(savedKey, detail)) {
				throw new Error("Reference creation context is no longer available.");
			}
		} finally {
			completingReferenceCreation.value = false;
		}
	};

	const submitController = useCollectionFormSubmit<TModel, TKey, TCreate, TUpdate>({
		api: {
			create: options.api.create,
			update: options.api.update,
		},
		mode,
		key,
		fields: options.fields,
		createSchema: options.createSchema,
		updateSchema: options.updateSchema,
		errors,
		onSuccess: async (result) => {
			if (
				result.operation === "create"
				&& result.key !== null
				&& referenceCreation.creationMode.value
			) {
				createdKey.value = result.key;
				await returnCreatedReference(result.key);
				return;
			}

			const success = options.success;
			if (!success || success.mode === "back") {
				await goBack();
				return;
			}

			if (result.operation === "create" && result.key !== null) {
				await router.replace(success.editRoute(result.key));
			}

			await load();
		},
	});

	const load = async (): Promise<void> => {
		loading.value = true;
		try {
			errors.clear();
			if (mode.value === "edit") {
				const detail = await options.api.detail(key.value);
				model.value = options.fromDetail
					? options.fromDetail(detail)
					: detail as unknown as TModel;
				submitController.setInitialModel(model.value);
				return;
			}

			if (mode.value === "copy") {
				const copyKey = options.copyKeyFromRoute?.(route);
				if (copyKey !== null && copyKey !== undefined) {
					const detail = await options.api.detail(copyKey);
					model.value = options.copyModel
						? options.copyModel(detail)
						: options.fromDetail
							? options.fromDetail(detail)
							: detail as unknown as TModel;
					submitController.setInitialModel(null);
					return;
				}
			}

			model.value = options.createModel();
			submitController.setInitialModel(null);
		} catch (err: unknown) {
			errors.setFromError(err);
		} finally {
			loading.value = false;
		}
	};

	const submit = async (value: TModel): Promise<void> => {
		if (submitController.submitting.value || completingReferenceCreation.value) {
			return;
		}

		if (createdKey.value !== null && referenceCreation.creationMode.value) {
			errors.clear();
			try {
				await returnCreatedReference(createdKey.value);
			} catch (err: unknown) {
				errors.setFromError(err);
			}
			return;
		}

		await submitController.submit(value);
	};

	onMounted(load);

	return {
		mode,
		key,
		model,
		loading,
		errors,
		submitting: submitController.submitting,
		createdKey,
		completingReferenceCreation,
		submit,
		load,
		goBack,
	};
};
