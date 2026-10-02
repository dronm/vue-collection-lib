import type {
	GridCellDataType,
	GridColumn,
	GridEnumOption,
} from "./types";

export type GridDateDataType = Extract<GridCellDataType, "date" | "datetime">;

export const isGridDateDataType = (
	dataType: GridCellDataType | undefined,
): dataType is GridDateDataType => {
	return dataType === "date" || dataType === "datetime";
};

export const gridDatePickerProps = (
	dataType: GridDateDataType,
	editorProps?: Record<string, unknown>,
): Record<string, unknown> => {
	return {
		showIcon: true,
		showClear: true,
		...(dataType === "datetime"
			? {
				hourFormat: "24",
			}
			: {}),
		...editorProps,
		showTime: dataType === "datetime",
		selectionMode: "single",
		updateModelType: "date",
	};
};

export const resolveGridEnumOptionLabel = (
	option: GridEnumOption,
	translate?: (key: string) => string,
): string => {
	if (option.label !== undefined) {
		return option.label;
	}

	if (option.labelKey !== undefined && translate !== undefined) {
		return translate(option.labelKey);
	}

	return String(option.value);
};

export const resolveGridEnumValueLabel = (
	value: unknown,
	options?: readonly GridEnumOption[],
	translate?: (key: string) => string,
): string => {
	if (value === null || value === undefined) {
		return "";
	}

	const option = options?.find((item) => item.value === value);

	return option !== undefined
		? resolveGridEnumOptionLabel(option, translate)
		: String(value);
};

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

export const makeCreateModel = <
	TModel extends object,
	TNew,
>(
	current: TModel,
	columns: GridColumn<TModel>[],
): TNew => {
	const result: Record<string, unknown> = {};

	columns
		.filter((column) => column.editable)
		.forEach((column) => {
			result[column.field] = current[column.field];
		});

	return result as TNew;
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
	translate?: (key: string) => string,
): string => {
	const value = row[column.field];

	if (column.format) {
		return column.format(value, row);
	}

	if (column.dataType === "enum") {
		return resolveGridEnumValueLabel(value, column.enumOptions, translate);
	}

	if (value instanceof Date) {
		return column.dataType === "date"
			? value.toLocaleDateString()
			: value.toLocaleString();
	}

	if (typeof value === "boolean") {
		return value ? "✓" : "";
	}

	if (value === null || value === undefined) {
		return "";
	}

	return String(value);
};
