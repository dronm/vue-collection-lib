import {
	ref,
	toValue,
	type MaybeRefOrGetter,
} from "vue";

import {
	FilterOperatorParam,
	SortDirect,
	type CollectionParams,
	type CollectionResponse,
	type CollectionSorter,
} from "../types/collection";
import type { CollectionGridApi } from "../components/crudGrid/types";

export interface UseChildCollectionOptions<
	TModel extends object,
	TKey,
	TNew,
	TUpd,
	TParentValue,
> {
	api: CollectionGridApi<TModel, TKey, TNew, TUpd>;
	parent: {
		field: keyof TModel & string;
		value: MaybeRefOrGetter<TParentValue>;
	};
	getKey: (row: TModel) => TKey;
	createModel: (row: TModel) => TNew;
	createDefaults: () => Partial<TModel>;
	lineNumberField?: keyof TModel & string;
	temporaryKeyField?: keyof TModel & string;
	temporaryKeyStart?: number;
}

export const useChildCollection = <
	TModel extends object,
	TKey,
	TNew,
	TUpd,
	TParentValue = unknown,
>(
	options: UseChildCollectionOptions<TModel, TKey, TNew, TUpd, TParentValue>,
) => {
	const nextLineNumber = ref(1);
	let nextTemporaryKey = options.temporaryKeyStart ?? -1;

	const withParentFilter = (params?: CollectionParams): CollectionParams => ({
		...params,
		filter: [
			{
				f: {
					[options.parent.field]: {
						o: FilterOperatorParam.E,
						v: toValue(options.parent.value),
					},
				},
			},
			...(params?.filter ?? []),
		],
	});

	const updateNextLineNumber = async (
		response: CollectionResponse<TModel>,
	): Promise<void> => {
		if (!options.lineNumberField) {
			return;
		}

		const field = options.lineNumberField;
		let maxLine = response.rows.reduce((currentMax, row) => {
			const value = Number((row as Record<string, unknown>)[field] ?? 0);
			return Math.max(currentMax, Number.isFinite(value) ? value : 0);
		}, 0);

		if (response.agg.tot_count > response.rows.length) {
			const lastLineResponse = await options.api.list({
				from: 0,
				count: 1,
				filter: withParentFilter().filter,
				sorter: [{
					f: field,
					d: SortDirect.DESC,
				}],
			});
			if (lastLineResponse) {
				const value = Number(
					(lastLineResponse.rows[0] as Record<string, unknown> | undefined)?.[field] ?? 0,
				);
				maxLine = Math.max(maxLine, Number.isFinite(value) ? value : 0);
			}
		}

		nextLineNumber.value = maxLine + 1;
	};

	const gridApi: CollectionGridApi<TModel, TKey, TNew, TUpd> = {
		serviceName: options.api.serviceName,
		list: async (params) => {
			const response = await options.api.list(withParentFilter(params));
			if (!response) {
				return;
			}

			await updateNextLineNumber(response);
			return response;
		},
		create: options.api.create,
		update: options.api.update,
		delete: options.api.delete,
	};

	const createRow = (): TModel => {
		const row: Record<string, unknown> = {
			...options.createDefaults(),
			[options.parent.field]: toValue(options.parent.value),
		};

		if (options.lineNumberField) {
			row[options.lineNumberField] = nextLineNumber.value;
		}

		if (options.temporaryKeyField) {
			row[options.temporaryKeyField] = nextTemporaryKey;
			nextTemporaryKey -= 1;
		}

		return row as unknown as TModel;
	};

	const defaultSorter: CollectionSorter[] = options.lineNumberField
		? [{
			f: options.lineNumberField,
			d: SortDirect.ASC,
		}]
		: [];

	return {
		api: gridApi,
		getKey: options.getKey,
		createRow,
		createModel: options.createModel,
		defaultSorter,
		nextLineNumber,
	};
};
