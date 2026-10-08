import type { RouteLocationRaw } from "vue-router";

import type { CollectionParams } from "../types/collection";
import type { CollectionDefinition } from "./collectionDefinition";
import type { GridCreateContext } from "../components/crudGrid/types";
export type ReferenceKeyValue = string | number | boolean | null;

export type ReferenceKeys = Record<string, ReferenceKeyValue>;

export type ReferenceRow = object;

export interface ReferenceValue<TKey extends ReferenceKeys = ReferenceKeys> {
	keys: TKey | null;
	descr: string;
	dataType?: string;
	[field: string]: unknown;
}

export interface ReferenceCollectionResponse<TRow extends ReferenceRow> {
	rows: TRow[];
	agg?: Record<string, unknown>;
}

export type ReferenceListResult<TRow extends ReferenceRow> =
	| ReferenceCollectionResponse<TRow>
	| TRow[]
	| void;

export type ReferenceListFn<TRow extends ReferenceRow> = (
	params?: CollectionParams,
) => Promise<ReferenceListResult<TRow>>;

export interface ReferenceAutocompleteConfig<
	TRow extends ReferenceRow = ReferenceRow,
	TKeys extends ReferenceKeys = ReferenceKeys,
> {
	list?: ReferenceListFn<TRow>;
	rows?: TRow[];
	keyFields: (keyof TRow & string)[];
	descrFields?: (keyof TRow & string)[];
	dataFields?: (keyof TRow & string)[];
	descrFieldConcat?: string;
	format?: (row: TRow) => string;
	queryParams?: (search: string) => CollectionParams;
	minLength?: number;
	delay?: number;
	forceSelection?: boolean;
	completeOnFocus?: boolean;
	dataType?: string;
	__keysType?: TKeys;
}

export interface ReferenceRouteAction<TRef extends ReferenceValue = ReferenceValue> {
	route?: RouteLocationRaw | ((value: TRef) => RouteLocationRaw);
	target?: "_self" | "_blank";
	disabled?: boolean;
}

export interface ReferenceSelectAction {
	route?: RouteLocationRaw | (() => RouteLocationRaw);
	target?: "_self" | "_blank";
	disabled?: boolean;
}

export interface ReferenceCreateActionBase<TRow extends ReferenceRow = ReferenceRow> {
	title?: string;
	disabled?: boolean;
	/** Adapt the saved detail projection to the row expected by autocomplete. */
	rowFromDetail?: (detail: object) => TRow;
	/** Adapt unusual API create-key shapes to the autocomplete key fields. */
	keysFromCreated?: (key: unknown) => ReferenceKeys;
}

export interface ReferenceCreateDialogAction<TRow extends ReferenceRow = ReferenceRow>
	extends ReferenceCreateActionBase<TRow> {
	mode: "dialog";
	/** A lazy provider keeps collection configuration out of the input itself. */
	collection: () => CollectionDefinition<any, any, any, any, any>;
	context?: GridCreateContext | (() => GridCreateContext);
}

export interface ReferenceCreatePageAction<TRow extends ReferenceRow = ReferenceRow>
	extends ReferenceCreateActionBase<TRow> {
	mode: "page";
	route: RouteLocationRaw | (() => RouteLocationRaw);
	/** Creation pages stay in another tab so the parent draft stays mounted. */
	target?: "_blank";
}

export type ReferenceCreateAction<TRow extends ReferenceRow = ReferenceRow> =
	| ReferenceCreateDialogAction<TRow>
	| ReferenceCreatePageAction<TRow>;
