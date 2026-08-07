import type { GridColumn } from "./types";

export const cloneGridRow = <TModel extends object>(
	row: TModel,
): TModel => {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => {
			return [
				key,
				value instanceof Date ? new Date(value) : value,
			];
		}),
	) as TModel;
};

const valuesEqual = (
	left: unknown,
	right: unknown,
): boolean => {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}

	return Object.is(left, right);
};

export const makeChangedModel = <
	TModel extends object,
	TUpd extends object,
>(
	original: TModel,
	current: TModel,
	columns: GridColumn<TModel>[],
): TUpd => {
	const result: Record<string, unknown> = {};

	columns
		.filter((column) => column.editable)
		.forEach((column) => {
			const field = column.field;
			if (!valuesEqual(original[field], current[field])) {
				result[field] = current[field];
			}
		});

	return result as TUpd;
};

export const formatGridValue = <TModel extends object>(
	row: TModel,
	column: GridColumn<TModel>,
): string => {
	const value = row[column.field];

	if (column.format) {
		return column.format(value, row);
	}

	if (value instanceof Date) {
		return value.toLocaleString();
	}

	if (typeof value === "boolean") {
		return value ? "✓" : "";
	}

	if (value === null || value === undefined) {
		return "";
	}

	return String(value);
};
