import { reactive } from "vue";

import type { GridColumn } from "./types";

/**
 * PrimeVue DataTable row editing exposes a plain cloned row object.
 * Always wrap that draft before exposing it to inline editors so
 * cross-field mutations participate in Vue reactivity.
 *
 * Vue caches proxies per raw target, so repeated calls for the same
 * edit-row draft return the same proxy.
 */
export const getReactiveGridEditRow = <TModel extends object>(
	row: TModel,
): TModel => {
	return reactive(row) as TModel;
};

/**
 * Single write path for every inline cell edit.
 *
 * The raw editor value is normalized when the column defines
 * normalizeValue(), then assigned on the reactive PrimeVue draft.
 * Finally the optional setValue hook runs against the same reactive row
 * and may update dependent sibling fields.
 */
export const applyGridInlineValue = async <TModel extends object>(
	row: TModel,
	column: GridColumn<TModel>,
	value: unknown,
): Promise<void> => {
	const editRow = getReactiveGridEditRow(row);
	const nextValue = column.normalizeValue
		? column.normalizeValue(value, editRow)
		: value;

	(editRow as Record<string, unknown>)[column.field] = nextValue;

	if (column.setValue) {
		await column.setValue(editRow, nextValue);
	}
};
