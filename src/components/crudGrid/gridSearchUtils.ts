import {
	FilterJoinParam,
	FilterOperatorParam,
	type CollectionFilter,
	type CollectionFilterFields,
} from "../../types/collection";
import type {
	GridColumn,
	GridSearchColumnOption,
	GridSearchCriterion,
	GridSearchDataType,
	GridSearchInput,
	GridSearchOperation,
	GridSearchRangeBound,
	GridSearchRangeValue,
	GridSearchSingleValue,
	GridSearchValue,
	GridSearchValueContext,
} from "./types";
import type { ReferenceValue } from "../../types/reference";

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isReferenceValue = (value: unknown): value is ReferenceValue => {
	return isRecord(value) && "keys" in value && "descr" in value;
};

export const isSearchRangeValue = (
	value: unknown,
): value is GridSearchRangeValue => {
	return isRecord(value) && "from" in value && "to" in value;
};

export const searchOperationsForType = (
	dataType: GridSearchDataType,
): GridSearchOperation[] => {
	if (dataType === "string") {
		return ["begins", "contains", "exact"];
	}

	if (dataType === "number" || dataType === "date") {
		return ["exact", "range"];
	}

	return ["exact"];
};

export const buildSearchColumnOptions = <TModel extends object>(
	columns: GridColumn<TModel>[],
	translate: (key: string) => string,
): GridSearchColumnOption[] => {
	return columns
		.filter((column) => column.searchable !== false)
		.map((column) => {
			const dataType = column.searchDataType ?? column.dataType ?? "string";

			return {
				field: column.field,
				header: column.header ?? translate(column.headerKey),
				searchField: column.searchField ?? column.field,
				dataType,
				operations: column.searchOperations ?? searchOperationsForType(dataType),
				referenceKeys: column.searchReferenceKeys,
				referenceAutocomplete: column.searchReferenceAutocomplete,
				referenceOpenAction: column.searchReferenceOpenAction,
				referenceSelectAction: column.searchReferenceSelectAction,
				searchComponent: column.searchComponent,
				searchComponentProps: column.searchComponentProps,
				searchDateOnly: column.searchDateOnly,
				searchValueToFilter: column.searchValueToFilter,
				searchValueLabel: column.searchValueLabel,
			};
		});
};

export const makeSearchCriterionId = (): string => {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

const pad2 = (value: number): string => {
	return value.toString().padStart(2, "0");
};

const pad3 = (value: number): string => {
	return value.toString().padStart(3, "0");
};

const formatLocalDate = (value: Date): string => {
	return [
		value.getFullYear(),
		pad2(value.getMonth() + 1),
		pad2(value.getDate()),
	].join("-");
};

const formatLocalDateTime = (value: Date): string => {
	return `${formatLocalDate(value)}T${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}.${pad3(value.getMilliseconds())}`;
};

const dateAtDayStart = (value: Date): Date => {
	return new Date(
		value.getFullYear(),
		value.getMonth(),
		value.getDate(),
		0,
		0,
		0,
		0,
	);
};

const dateAtDayEnd = (value: Date): Date => {
	return new Date(
		value.getFullYear(),
		value.getMonth(),
		value.getDate(),
		23,
		59,
		59,
		999,
	);
};

const parseDateValue = (value: GridSearchSingleValue): Date | null => {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}

	if (typeof value === "string" && value !== "") {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	return null;
};

const makeValueContext = (
	column: GridSearchColumnOption,
	operation: GridSearchOperation,
	bound?: GridSearchRangeBound,
): GridSearchValueContext => {
	return {
		field: column.field,
		searchField: column.searchField,
		dataType: column.dataType,
		operation,
		bound,
	};
};

export const normalizeSearchValue = (
	value: GridSearchSingleValue,
	column?: GridSearchColumnOption,
	operation: GridSearchOperation = "exact",
	bound?: GridSearchRangeBound,
): unknown => {
	if (column?.searchValueToFilter) {
		return column.searchValueToFilter(
			value,
			makeValueContext(column, operation, bound),
		);
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	return value;
};

const normalizeDateSearchValue = (
	value: GridSearchSingleValue,
	column: GridSearchColumnOption,
	operation: GridSearchOperation,
	bound: GridSearchRangeBound,
): unknown => {
	if (column.searchValueToFilter) {
		return column.searchValueToFilter(
			value,
			makeValueContext(column, operation, bound),
		);
	}

	const parsed = parseDateValue(value);
	if (!parsed) {
		return null;
	}

	if (column.searchDateOnly === false) {
		return parsed.toISOString();
	}

	return formatLocalDateTime(
		bound === "from"
			? dateAtDayStart(parsed)
			: dateAtDayEnd(parsed),
	);
};

const singleReferenceKeyValue = (
	value: ReferenceValue,
): unknown => {
	if (!value.keys) {
		return null;
	}

	const keys = Object.keys(value.keys);
	if (keys.length !== 1) {
		return null;
	}

	return value.keys[keys[0]];
};

const buildReferenceFilterFields = (
	column: GridSearchColumnOption,
	value: ReferenceValue,
): CollectionFilterFields => {
	if (!value.keys) {
		return {};
	}

	const filterFields: CollectionFilterFields = {};

	if (column.referenceKeys) {
		Object.entries(column.referenceKeys).forEach(([keyField, filterField]) => {
			const keyValue = value.keys?.[keyField];

			if (keyValue !== undefined && keyValue !== null) {
				filterFields[filterField] = {
					o: FilterOperatorParam.E,
					v: keyValue,
				};
			}
		});

		return filterFields;
	}

	const keyValue = singleReferenceKeyValue(value);
	if (keyValue !== null && keyValue !== undefined) {
		filterFields[column.searchField] = {
			o: FilterOperatorParam.E,
			v: keyValue,
		};
	}

	return filterFields;
};

const buildSingleFieldFilter = (
	field: string,
	operator: FilterOperatorParam,
	value: unknown,
): CollectionFilter => {
	return {
		j: FilterJoinParam.AND,
		f: {
			[field]: {
				o: operator,
				v: value,
			},
		},
	};
};

export const buildSearchFilters = (
	column: GridSearchColumnOption,
	operation: GridSearchOperation,
	value: GridSearchValue,
): CollectionFilter[] => {
	if (column.dataType === "reference" && isReferenceValue(value)) {
		return [{
			j: FilterJoinParam.AND,
			f: buildReferenceFilterFields(column, value),
		}];
	}

	if (operation === "range" && isSearchRangeValue(value)) {
		const filters: CollectionFilter[] = [];

		if (!searchValueIsEmpty(value.from)) {
			const filterValue = column.dataType === "date"
				? normalizeDateSearchValue(value.from, column, operation, "from")
				: normalizeSearchValue(value.from, column, operation, "from");

			filters.push(buildSingleFieldFilter(
				column.searchField,
				FilterOperatorParam.GE,
				filterValue,
			));
		}

		if (!searchValueIsEmpty(value.to)) {
			const filterValue = column.dataType === "date"
				? normalizeDateSearchValue(value.to, column, operation, "to")
				: normalizeSearchValue(value.to, column, operation, "to");

			filters.push(buildSingleFieldFilter(
				column.searchField,
				FilterOperatorParam.LE,
				filterValue,
			));
		}

		return filters;
	}

	if (column.dataType === "date" && operation === "exact") {
		const parsed = parseDateValue(value as GridSearchSingleValue);
		if (parsed && column.searchDateOnly !== false) {
			return [
				buildSingleFieldFilter(
					column.searchField,
					FilterOperatorParam.GE,
					normalizeDateSearchValue(parsed, column, operation, "from"),
				),
				buildSingleFieldFilter(
					column.searchField,
					FilterOperatorParam.LE,
					normalizeDateSearchValue(parsed, column, operation, "to"),
				),
			];
		}
	}

	let filterValue = normalizeSearchValue(
		value as GridSearchSingleValue,
		column,
		operation,
	);
	let operator: FilterOperatorParam = FilterOperatorParam.E;

	if (column.dataType === "string" && typeof value === "string") {
		if (operation === "begins") {
			operator = FilterOperatorParam.ILK;
			filterValue = `${filterValue}%`;
		} else if (operation === "contains") {
			operator = FilterOperatorParam.ILK;
			filterValue = `%${filterValue}%`;
		}
	}

	return [buildSingleFieldFilter(column.searchField, operator, filterValue)];
};

export const buildSearchFilter = (
	column: GridSearchColumnOption,
	operation: GridSearchOperation,
	value: GridSearchValue,
): CollectionFilter => {
	return buildSearchFilters(column, operation, value)[0] ?? {
		j: FilterJoinParam.AND,
		f: {},
	};
};

export const searchValueIsEmpty = (
	value: GridSearchValue,
): boolean => {
	if (value === null || value === undefined) {
		return true;
	}

	if (isSearchRangeValue(value)) {
		return searchValueIsEmpty(value.from) && searchValueIsEmpty(value.to);
	}

	if (typeof value === "string") {
		return value.trim() === "";
	}

	if (isReferenceValue(value)) {
		return value.keys === null;
	}

	return false;
};

const formatSingleSearchValue = (
	value: GridSearchSingleValue,
): string => {
	if (value === null || value === undefined) {
		return "";
	}

	if (value instanceof Date) {
		return value.toLocaleDateString();
	}

	if (isReferenceValue(value)) {
		return value.descr;
	}

	return String(value);
};

export const formatSearchValue = (
	value: GridSearchValue,
): string => {
	if (isSearchRangeValue(value)) {
		return `${formatSingleSearchValue(value.from)} - ${formatSingleSearchValue(value.to)}`;
	}

	return formatSingleSearchValue(value);
};

export const formatSearchValueForOperation = (
	value: GridSearchValue,
	operation: GridSearchOperation,
	column?: GridSearchColumnOption,
): string => {
	const context = column
		? makeValueContext(column, operation)
		: null;
	const formatted = column?.searchValueLabel && context
		? column.searchValueLabel(value, context)
		: formatSearchValue(value);

	if (operation === "begins") {
		return `${formatted}*`;
	}

	if (operation === "contains") {
		return `*${formatted}*`;
	}

	return formatted;
};

export const buildSearchCriterion = (
	input: GridSearchInput,
	columns: GridSearchColumnOption[],
	translate: (key: string, params?: Record<string, unknown>) => string,
	id?: string,
): GridSearchCriterion | null => {
	const column = columns.find((item) => item.field === input.field);

	if (!column || searchValueIsEmpty(input.value)) {
		return null;
	}

	const operation = column.operations.includes(input.operation)
		? input.operation
		: column.operations[0] ?? "exact";
	const filters = buildSearchFilters(column, operation, input.value);

	return {
		id: id ?? makeSearchCriterionId(),
		field: column.field,
		label: column.header,
		operation,
		operationLabel: translate(`Grid.search.operations.${operation}`),
		value: input.value,
		valueLabel: formatSearchValueForOperation(input.value, operation, column),
		filter: filters[0] ?? {
			j: FilterJoinParam.AND,
			f: {},
		},
		filters,
		removable: true,
	};
};
