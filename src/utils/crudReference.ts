import type { RouteLocationRaw } from "vue-router";

import type { ReferenceListFn } from "../types/reference";
import type {
	CrudReferenceDefinition,
} from "../types/referenceDefinition";
import type {
	ReferenceKeys,
	ReferenceKeyValue,
	ReferenceRow,
	ReferenceValue,
} from "../types/reference";
import { referenceAutocompleteEq } from "./referenceAutocomplete";
import { referenceFromRow } from "./reference";

export interface DefineCrudReferenceOptions<
	TRow extends ReferenceRow,
	TKeys extends ReferenceKeys,
	TValue extends ReferenceKeyValue,
> {
	list: ReferenceListFn<TRow>;
	detail: (key: TKeys) => Promise<TRow>;
	keyField: keyof TKeys & keyof TRow & string;
	searchField: keyof TRow & string;
	descrFields?: (keyof TRow & string)[];
	dataFields?: (keyof TRow & string)[];
	format?: (row: TRow) => string;
	minLength?: number;
	count?: number;
	forceSelection?: boolean;
	completeOnFocus?: boolean;
	fallback?: (value: TValue) => string;
	isEmpty?: (value: TValue) => boolean;
	emptyValue?: TValue | null;
	openRoute?: (value: ReferenceValue<TKeys>) => RouteLocationRaw;
	selectRoute?: RouteLocationRaw | (() => RouteLocationRaw);
	openTarget?: "_self" | "_blank";
	selectTarget?: "_self" | "_blank";
}

export const defineCrudReference = <
	TRow extends ReferenceRow,
	TKeys extends ReferenceKeys,
	TValue extends ReferenceKeyValue = TKeys[keyof TKeys] & ReferenceKeyValue,
>(
	options: DefineCrudReferenceOptions<TRow, TKeys, TValue>,
): CrudReferenceDefinition<TRow, TKeys, TValue> => {
	const autocomplete = referenceAutocompleteEq<TRow, TKeys>({
		searchField: options.searchField,
		keyFields: [options.keyField],
		descrFields: options.descrFields,
		dataFields: options.dataFields,
		list: options.list,
		format: options.format,
		minLength: options.minLength ?? 0,
		count: options.count,
		forceSelection: options.forceSelection ?? true,
		completeOnFocus: options.completeOnFocus ?? true,
	});
	const cache = new Map<ReferenceKeyValue, Promise<ReferenceValue<TKeys> | null>>();

	const valueFromReference = (
		value: ReferenceValue<TKeys> | null | undefined,
	): TValue | null => {
		return (value?.keys?.[options.keyField] as TValue | null | undefined)
			?? options.emptyValue
			?? null;
	};

	const load = (
		value: TValue | null | undefined,
		projectedValue?: unknown,
	): Promise<ReferenceValue<TKeys> | null> => {
		if (
			value === null
			|| value === undefined
			|| value === ""
			|| options.isEmpty?.(value)
		) {
			return Promise.resolve(null);
		}

		// Only use a projection belonging to the currently selected key.
		if (
			typeof projectedValue === "object" && projectedValue !== null &&
			"keys" in projectedValue && "descr" in projectedValue &&
			typeof projectedValue.descr === "string" &&
			typeof projectedValue.keys === "object" && projectedValue.keys !== null &&
			(projectedValue.keys as Record<string, unknown>)[options.keyField] === value
		) {
			const projected = Promise.resolve(projectedValue as ReferenceValue<TKeys>);
			cache.set(value, projected);
			return projected;
		}

		const existing = cache.get(value);
		if (existing) {
			return existing;
		}

		const key = {
			[options.keyField]: value,
		} as unknown as TKeys;
		const promise = options.detail(key)
			.then((row) => referenceFromRow(row, autocomplete))
			.catch(() => ({
				keys: key,
				descr: options.fallback?.(value) ?? String(value),
			}));
		cache.set(value, promise);

		return promise;
	};

	return {
		autocomplete,
		load,
		valueFromReference,
		openRoute: options.openRoute,
		selectRoute: options.selectRoute,
		openTarget: options.openTarget ?? "_blank",
		selectTarget: options.selectTarget ?? "_blank",
	};
};
