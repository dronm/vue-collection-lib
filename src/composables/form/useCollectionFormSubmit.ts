import {
	computed,
	ref,
	toValue,
} from "vue";

import type {
	CollectionSubmitOperation,
	CollectionSubmitResult,
	UseCollectionFormSubmitOptions,
} from "../../types/formSubmit";
import { useFormMutation } from "./useFormMutation";
import {
	collectionFormSubmitErrorEvent,
	collectionFormSubmitSuccessEvent,
} from "./events";
import { parseWithSchema } from "../../utils/validation";

const isEmptyObject = (value: object): boolean => {
	return Object.keys(value).length === 0;
};

const dispatchCollectionFormEvent = (
	name: string,
	detail: unknown,
): void => {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new CustomEvent(name, {
		detail,
	}));
};

export const useCollectionFormSubmit = <
	TDetail extends object,
	TKey,
	TCreate extends object,
	TUpdate extends object,
>(
	options: UseCollectionFormSubmitOptions<TDetail, TKey, TCreate, TUpdate>,
) => {
	const submitting = ref(false);
	const mutation = useFormMutation<TDetail, TCreate, TUpdate>({
		fields: options.fields,
	});

	const operation = computed<CollectionSubmitOperation>(() => {
		return toValue(options.mode) === "edit" ? "update" : "create";
	});

	const validateCreateModel = async (
		model: TCreate,
		detail: TDetail,
	): Promise<TCreate> => {
		let result = options.createSchema
			? parseWithSchema(options.createSchema, model)
			: model;

		if (options.validateCreate) {
			const customResult = await options.validateCreate(result, detail);
			if (customResult) {
				result = customResult;
			}
		}

		return result;
	};

	const validateUpdateModel = async (
		model: TUpdate,
		detail: TDetail,
	): Promise<TUpdate> => {
		let result = options.updateSchema
			? parseWithSchema(options.updateSchema, model)
			: model;

		if (options.validateUpdate) {
			const customResult = await options.validateUpdate(result, detail);
			if (customResult) {
				result = customResult;
			}
		}

		return result;
	};

	const submitCreate = async (
		detail: TDetail,
	): Promise<CollectionSubmitResult<TKey, TCreate, TUpdate>> => {
		const model = await validateCreateModel(
			mutation.buildCreateModel(detail),
			detail,
		);
		const result = await options.api.create(model);

		return {
			operation: "create",
			key: result,
			model,
			changed: true,
			result,
		};
	};

	const submitUpdate = async (
		detail: TDetail,
	): Promise<CollectionSubmitResult<TKey, TCreate, TUpdate>> => {
		const key = options.key === undefined ? null : toValue(options.key);
		if (key === null || key === undefined) {
			throw new Error("edit key is undefined");
		}

		const model = await validateUpdateModel(
			mutation.buildUpdateModel(detail),
			detail,
		);

		if ((options.skipEmptyUpdate ?? true) && isEmptyObject(model)) {
			return {
				operation: "update",
				key,
				model,
				changed: false,
				result: null,
			};
		}

		const result = await options.api.update(key, model);

		return {
			operation: "update",
			key,
			model,
			changed: true,
			result,
		};
	};

	const submit = async (
		detail: TDetail,
	): Promise<CollectionSubmitResult<TKey, TCreate, TUpdate> | null> => {
		submitting.value = true;
		options.errors?.clear();

		try {
			const result = operation.value === "update"
				? await submitUpdate(detail)
				: await submitCreate(detail);

			mutation.setInitialModel(detail);
			dispatchCollectionFormEvent(collectionFormSubmitSuccessEvent, result);
			await options.onSuccess?.(result);

			return result;
		} catch (err: unknown) {
			options.errors?.setFromError(err);
			dispatchCollectionFormEvent(collectionFormSubmitErrorEvent, err);
			await options.onError?.(err);

			if (options.throwOnError) {
				throw err;
			}

			return null;
		} finally {
			submitting.value = false;
		}
	};

	return {
		submitting,
		operation,
		initialModel: mutation.initialModel,
		setInitialModel: mutation.setInitialModel,
		buildCreateModel: mutation.buildCreateModel,
		buildUpdateModel: mutation.buildUpdateModel,
		hasChanges: mutation.hasChanges,
		submit,
	};
};
