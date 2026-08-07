export const FilterOperatorParam = {
	E: "e", // equal
	L: "l", // less
	G: "g", // greater
	LE: "le", // less and equal
	GE: "ge", // greater and equal
	LK: "lk", // like
	ILK: "ilk", // ilike
	NE: "ne", // not equal
	I: "i", // IS
	IN: "in", // in
	INCL: "incl", // column = ANY(param array)
	ANY: "any", // column = ANY(param array)
	HAS: "has", // param = ANY(column_array)
	OVERLAP: "overlap", // overlap
	CONTAINS: "contains", // contains
	TS: "fts", // full text search
} as const;
export type FilterOperatorParam = (typeof FilterOperatorParam)[keyof typeof FilterOperatorParam];

export const SortDirect = {
	ASC: "a",
	DESC: "d",
} as const;
export type SortDirect = (typeof SortDirect)[keyof typeof SortDirect];

export const FilterJoinParam = {
	AND: "and",
	OR: "or",
} as const;
export type FilterJoinParam = (typeof FilterJoinParam)[keyof typeof FilterJoinParam];

export interface CollectionSorter {
	f: string;
	d: SortDirect;
}

export interface CollectionFilterField {
	o: FilterOperatorParam;
	v: unknown;
}

export interface CollectionFilterFields {
	[key: string]: CollectionFilterField;
}

export interface CollectionFilter {
	j?: FilterJoinParam;
	f: CollectionFilterFields;
}

export interface SortChangeEvent {
	field: SortField;
	isAscending: boolean;
}

export interface SortField {
	name: string;
	descr: string;
	isAscending: boolean;
}

export interface CollectionParams {
	filter?: CollectionFilter[];
	sorter?: CollectionSorter[];
	from?: number;
	count?: number;
}

export interface CollectionTotCount {
	tot_count: number;
}

export type CollectionAgg = CollectionTotCount & Record<string, unknown>;

export interface CollectionResponse<TModel> {
	rows: TModel[];
	agg: CollectionAgg;
}

export interface CollectionDTO<TDTO> {
	rows: TDTO[];
	agg: CollectionAgg;
}

export type AggData = Record<string, number>;

export interface CollectionAlterResult {
	affectedRows: number;
}
