import type { GridColumn } from "../components/crudGrid/types";
import {
	FilterOperatorParam,
	SortDirect,
	type CollectionSorter,
	type CollectionWhere,
} from "../types/collection";

/** Scalar sorting values captured before a row can be changed by an editor. */
export interface CollectionCursor {
	readonly values: readonly unknown[];
}

export type CollectionCursorDirection = "after" | "before";

/** Keep the requested ordering and append the application's unique key fields. */
export const stableCollectionSorter = (
	sorter: readonly CollectionSorter[] | undefined,
	keyFields: readonly string[],
): CollectionSorter[] => {
	if (keyFields.length === 0) {
		throw new Error("Infinite scrolling requires at least one unique key field.");
	}

	const result: CollectionSorter[] = [];
	const fields = new Set<string>();
	for (const item of sorter ?? []) {
		if (!item.f || (item.d !== SortDirect.ASC && item.d !== SortDirect.DESC)) {
			throw new Error("Infinite scrolling requires valid sorting fields and directions.");
		}
		if (!fields.has(item.f)) {
			result.push({ ...item });
			fields.add(item.f);
		}
	}

	const direction = result.at(-1)?.d ?? SortDirect.DESC;
	for (const field of keyFields) {
		if (!field || field.trim() !== field) {
			throw new Error("Infinite scrolling requires non-empty unique key field names.");
		}
		if (!fields.has(field)) {
			result.push({ f: field, d: direction });
			fields.add(field);
		}
	}
	return result;
};

const readField = (row: object, field: string): unknown => {
	const record = row as Record<string, unknown>;
	if (Object.prototype.hasOwnProperty.call(record, field)) {
		return record[field];
	}

	let value: unknown = row;
	for (const segment of field.split(".")) {
		if (
			typeof value !== "object"
			|| value === null
			|| !Object.prototype.hasOwnProperty.call(value, segment)
		) {
			return undefined;
		}
		value = (value as Record<string, unknown>)[segment];
	}
	return value;
};

const localDate = (date: Date): string => {
	return [
		String(date.getFullYear()).padStart(4, "0"),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
};

/**
 * Resolve raw sortable values, including column aliases, without converting
 * decimal/bigint strings into lossy JavaScript numbers. Custom mappings can
 * retain server precision or expose values that are absent from the list model.
 */
export const snapshotCollectionCursor = <TModel extends object>(
	row: TModel,
	sorter: readonly CollectionSorter[],
	columns: readonly GridColumn<TModel>[],
	getCursorValue?: (row: TModel, field: string) => unknown,
): CollectionCursor => {
	const values = sorter.map((item) => {
		const column = columns.find((candidate) => candidate.sortField === item.f)
			?? columns.find((candidate) => candidate.field === item.f);
		let value = getCursorValue ? getCursorValue(row, item.f) : readField(row, item.f);
		if (!getCursorValue && value === undefined && column) {
			value = readField(row, column.field);
		}

		if (value instanceof Date) {
			if (!Number.isFinite(value.getTime())) {
				throw new Error(`Invalid date cursor value for sorting field "${item.f}".`);
			}
			return column?.dataType === "date" ? localDate(value) : value.toISOString();
		}
		if (value === null || typeof value === "string" || typeof value === "boolean") {
			return value;
		}
		if (
			typeof value === "number"
			&& Number.isFinite(value)
			&& (!Number.isInteger(value) || Number.isSafeInteger(value))
		) {
			return value;
		}
		throw new Error(
			`Missing or unsupported cursor value for sorting field "${item.f}". `
			+ "Provide infiniteScroll.getCursorValue with the exact server sorting value.",
		);
	});
	return Object.freeze({ values: Object.freeze(values) });
};

const and = (conditions: CollectionWhere[]): CollectionWhere => {
	return conditions.length === 1 ? conditions[0]! : { and: conditions };
};

const or = (conditions: CollectionWhere[]): CollectionWhere => {
	return conditions.length === 1 ? conditions[0]! : { or: conditions };
};

const equal = (field: string, value: unknown): CollectionWhere => {
	return { f: field, o: value === null ? FilterOperatorParam.I : FilterOperatorParam.E, v: value };
};

const compare = (
	sort: CollectionSorter,
	value: unknown,
	direction: CollectionCursorDirection,
): CollectionWhere | null => {
	const ascending = sort.d === SortDirect.ASC;
	const after = direction === "after";
	if (value === null) {
		// PostgreSQL defaults to ASC NULLS LAST and DESC NULLS FIRST.
		return after !== ascending
			? { f: sort.f, o: FilterOperatorParam.IN, v: null }
			: null;
	}

	const comparison: CollectionWhere = {
		f: sort.f,
		o: after === ascending ? FilterOperatorParam.G : FilterOperatorParam.L,
		v: value,
	};
	return after === ascending
		? or([comparison, { f: sort.f, o: FilterOperatorParam.I, v: null }])
		: comparison;
};

/**
 * Build a lexicographic bound in display order. A null result means that no
 * rows can exist on the requested side; callers must not issue an unbounded
 * request in that case. "before" queries should invert the server sorter and
 * reverse their returned rows, so the nearest preceding rows are loaded first.
 */
export const collectionCursorWhere = (
	sorter: readonly CollectionSorter[],
	cursor: CollectionCursor,
	direction: CollectionCursorDirection,
	inclusive = false,
): CollectionWhere | null => {
	if (sorter.length === 0 || cursor.values.length !== sorter.length) {
		throw new Error("Cursor values must match a non-empty collection sorter.");
	}

	const alternatives: CollectionWhere[] = [];
	const prefix: CollectionWhere[] = [];
	for (let index = 0; index < sorter.length; index += 1) {
		const sort = sorter[index]!;
		const value = cursor.values[index];
		if (value === undefined) {
			throw new Error(`Missing cursor value for sorting field "${sort.f}".`);
		}
		const comparison = compare(sort, value, direction);
		if (comparison !== null) {
			alternatives.push(and([...prefix, comparison]));
		}
		prefix.push(equal(sort.f, value));
	}
	if (inclusive) {
		alternatives.push(and(prefix));
	}
	return alternatives.length === 0 ? null : or(alternatives);
};
