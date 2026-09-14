import type { RouteLocationRaw } from "vue-router";

import type {
	ReferenceAutocompleteConfig,
	ReferenceKeys,
	ReferenceKeyValue,
	ReferenceRow,
	ReferenceValue,
} from "./reference";

export interface CrudReferenceDefinition<
	TRow extends ReferenceRow = ReferenceRow,
	TKeys extends ReferenceKeys = ReferenceKeys,
	TValue extends ReferenceKeyValue = ReferenceKeyValue,
> {
	autocomplete: ReferenceAutocompleteConfig<TRow, TKeys>;
	load: (value: TValue | null | undefined, projectedValue?: unknown) => Promise<ReferenceValue<TKeys> | null>;
	valueFromReference: (value: ReferenceValue<TKeys> | null | undefined) => TValue | null;
	openRoute?: (value: ReferenceValue<TKeys>) => RouteLocationRaw;
	selectRoute?: RouteLocationRaw | (() => RouteLocationRaw);
	openTarget?: "_self" | "_blank";
	selectTarget?: "_self" | "_blank";
}
