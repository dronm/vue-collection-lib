import {
	computed,
	shallowRef,
	ref,
} from "vue";

import type { CollectionDefinition } from "../../types/collectionDefinition";
import type { GridColumn, GridCreateContext } from "../../components/crudGrid/types";
import { applyGridInlineValue, getReactiveGridEditRow } from "../../components/crudGrid/inlineEditing";
import { parseWithSchema } from "../../utils/validation";
import { useFormErrors } from "./useFormErrors";

export interface UseCollectionCreateOptions<
	TModel extends object,
	TKey,
	TNew,
	TUpd extends object,
	TDetailModel,
> {
	collection: CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel>;
	context?: GridCreateContext;
}

export interface CollectionCreateResult<TKey, TDetailModel> {
	key: TKey;
	detail: TDetailModel;
}

/**
 * Creates a reference target without changing the originating form's dirty state.
 * A successful POST is remembered independently of the subsequent detail load,
 * so retries can recover selection without creating duplicate records.
 */
export const useCollectionCreate = <
	TModel extends object,
	TKey,
	TNew,
	TUpd extends object,
	TDetailModel = TModel,
>(
	options: UseCollectionCreateOptions<TModel, TKey, TNew, TUpd, TDetailModel>,
) => {
	const collection = options.collection;
	const errors = useFormErrors();
	const submitting = ref(false);
	const available = ref(true);
	const saved = shallowRef<{ key: TKey } | null>(null);
	const completed = shallowRef<CollectionCreateResult<TKey, TDetailModel> | null>(null);
	const pendingValues = new Set<Promise<void>>();
	const valueErrors = new Map<string, unknown>();
	const valueVersions = new Map<string, number>();
	const editableColumns = computed(() => {
		return collection.columns.filter((column) => column.createEditable ?? column.editable);
	});
	const created = computed(() => saved.value !== null);
	const savedKey = computed(() => saved.value?.key);
	const loadCreated = collection.loadCreated ?? collection.api.detail;

	const createDraft = (): TModel => {
		try {
			if (!collection.createRow || !collection.api.create || !loadCreated) {
				throw new Error("Collection creation requires createRow, api.create, and api.detail or loadCreated");
			}

			const row = collection.createRow(options.context);
			if (options.context?.initialValues) {
				Object.assign(row, options.context.initialValues);
			}
			return getReactiveGridEditRow(row);
		} catch (err: unknown) {
			available.value = false;
			errors.setFromError(err);
			return getReactiveGridEditRow({} as TModel);
		}
	};
	const draft = createDraft();

	const updateValue = (
		column: GridColumn<TModel>,
		value: unknown,
	): Promise<void> => {
		if (submitting.value || created.value || !available.value) {
			return Promise.resolve();
		}

		errors.clearField(column.field);
		const version = (valueVersions.get(column.field) ?? 0) + 1;
		valueVersions.set(column.field, version);
		const task = applyGridInlineValue(draft, column, value)
			.then(() => {
				if (valueVersions.get(column.field) === version) {
					valueErrors.delete(column.field);
				}
			})
			.catch((err: unknown) => {
				if (valueVersions.get(column.field) === version) {
					valueErrors.set(column.field, err);
					errors.setFromError(err);
				}
			})
			.finally(() => {
				pendingValues.delete(task);
			});
		pendingValues.add(task);
		return task;
	};

	const buildModel = async (): Promise<TNew> => {
		const baseModel = collection.createModel
			? collection.createModel(draft)
			: Object.fromEntries(editableColumns.value.map((column) => {
				return [column.field, draft[column.field]];
			})) as TNew;
		const contextualModel = options.context?.initialValues
			? {
				...(baseModel as object),
				...options.context.initialValues,
			} as TNew
			: baseModel;
		let model = collection.createSchema
			? parseWithSchema(collection.createSchema, contextualModel)
			: contextualModel;
		if (collection.validateCreate) {
			const validated = await collection.validateCreate(model, draft);
			if (validated !== undefined) {
				model = validated;
			}
		}
		return model;
	};

	const submit = async (): Promise<CollectionCreateResult<TKey, TDetailModel> | null> => {
		if (submitting.value || !available.value) {
			return null;
		}

		submitting.value = true;
		errors.clear();
		try {
			if (completed.value !== null) {
				return completed.value;
			}

			if (saved.value === null) {
				await Promise.all([...pendingValues]);
				if (valueErrors.size > 0) {
					throw valueErrors.values().next().value;
				}
				const model = await buildModel();
				const key = await collection.api.create!(model);
				saved.value = { key };
			}

			const detail = await loadCreated!(saved.value.key);
			completed.value = { key: saved.value.key, detail };
			return completed.value;
		} catch (err: unknown) {
			errors.setFromError(err);
			return null;
		} finally {
			submitting.value = false;
		}
	};

	return {
		draft,
		errors,
		editableColumns,
		available,
		submitting,
		created,
		savedKey,
		updateValue,
		submit,
	};
};
