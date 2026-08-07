import type { RouteLocationRaw } from "vue-router";

import type { CollectionParams } from "../types/collection";
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
