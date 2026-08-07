import type { MaybeRefOrGetter } from "vue";
import type * as v from "valibot";

import type { CollectionAlterResult } from "../types/collection";
import type { FormErrorsController } from "./formErrors";
import type { FormMutationFieldConfig } from "./formMutation";

export type CollectionFormMode = "create" | "edit" | "copy";
export type CollectionSubmitOperation = "create" | "update";

export interface CollectionSubmitApi<TKey, TCreate, TUpdate> {
	create: (model: TCreate) => Promise<TKey>;
	update: (
		key: TKey,
		model: TUpdate,
	) => Promise<CollectionAlterResult>;
}

export interface CollectionSubmitResult<
	TKey,
	TCreate extends object,
	TUpdate extends object,
> {
	operation: CollectionSubmitOperation;
	key: TKey | null;
	model: TCreate | TUpdate;
	changed: boolean;
	result: TKey | CollectionAlterResult | null;
}

export interface UseCollectionFormSubmitOptions<
	TDetail extends object,
	TKey,
	TCreate extends object,
	TUpdate extends object,
> {
	api: CollectionSubmitApi<TKey, TCreate, TUpdate>;
	mode: MaybeRefOrGetter<CollectionFormMode>;
	key?: MaybeRefOrGetter<TKey | null | undefined>;
	fields: FormMutationFieldConfig<TDetail, TCreate | TUpdate>[];
	createSchema?: v.GenericSchema<TCreate>;
	updateSchema?: v.GenericSchema<TUpdate>;
	validateCreate?: (
		model: TCreate,
		detail: TDetail,
	) => TCreate | void | Promise<TCreate | void>;
	validateUpdate?: (
		model: TUpdate,
		detail: TDetail,
	) => TUpdate | void | Promise<TUpdate | void>;
	errors?: FormErrorsController;
	skipEmptyUpdate?: boolean;
	throwOnError?: boolean;
	onSuccess?: (
		result: CollectionSubmitResult<TKey, TCreate, TUpdate>,
	) => void | Promise<void>;
	onError?: (err: unknown) => void | Promise<void>;
}

export type CrudFormMode = CollectionFormMode;
export type CrudSubmitOperation = CollectionSubmitOperation;
export type CrudSubmitApi<TKey, TCreate, TUpdate> = CollectionSubmitApi<TKey, TCreate, TUpdate>;
export type CrudSubmitResult<TKey, TCreate extends object, TUpdate extends object> = CollectionSubmitResult<TKey, TCreate, TUpdate>;
export type UseCrudFormSubmitOptions<TDetail extends object, TKey, TCreate extends object, TUpdate extends object> = UseCollectionFormSubmitOptions<TDetail, TKey, TCreate, TUpdate>;
