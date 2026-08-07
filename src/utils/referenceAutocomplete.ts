import {
	FilterOperatorParam,
	type CollectionParams,
} from "../types/collection";
import type {
	ReferenceAutocompleteConfig,
	ReferenceKeys,
	ReferenceListFn,
	ReferenceRow,
} from "../types/reference";

export interface ReferenceAutocompleteEqOptions<
	TRow extends ReferenceRow,
	TKeys extends ReferenceKeys = ReferenceKeys,
> {
	searchField: keyof TRow & string;
	keyFields: (keyof TKeys & keyof TRow & string)[];
	descrFields?: (keyof TRow & string)[];
	dataFields?: (keyof TRow & string)[];
	list: ReferenceListFn<TRow>;
	format?: (row: TRow) => string;
	minLength?: number;
	count?: number;
	dataType?: string;
	forceSelection?: boolean;
	completeOnFocus?: boolean;
}

export const referenceAutocompleteEq = <
	TRow extends ReferenceRow,
	TKeys extends ReferenceKeys = ReferenceKeys,
>(
	options: ReferenceAutocompleteEqOptions<TRow, TKeys>,
): ReferenceAutocompleteConfig<TRow, TKeys> => {
	return {
		list: options.list,
		keyFields: options.keyFields,
		descrFields: options.descrFields,
		dataFields: options.dataFields,
		format: options.format,
		minLength: options.minLength ?? 1,
		dataType: options.dataType,
		forceSelection: options.forceSelection,
		completeOnFocus: options.completeOnFocus,
		queryParams: (search: string): CollectionParams => {
			return {
				from: 0,
				count: options.count ?? 20,
				filter: [
					{
						f: {
							[options.searchField]: {
								o: FilterOperatorParam.ILK,
								v: `%${search}%`,
							},
						},
					},
				],
			};
		},
	};
};
