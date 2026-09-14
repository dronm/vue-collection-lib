import type { Component } from "vue";
import type { RouteLocationRaw } from "vue-router";
import type {
	CollectionFilter,
	CollectionParams,
	CollectionResponse,
	CollectionSorter,
} from "../../types/collection";
import type { CrudReferenceDefinition } from "../../types/referenceDefinition";
import type { CollectionHierarchyConfig } from "../../types/collectionHierarchy";
import type {
	ReferenceAutocompleteConfig,
	ReferenceKeys,
	ReferenceRouteAction,
	ReferenceSelectAction,
	ReferenceValue,
} from "../../types/reference";

export type GridCommandName = "create" | "edit" | "copy" | "delete" | "search" | "refresh" | string;
export type GridCommandListMode = "default" | "append" | "replace";
export type GridEditMode = "inline" | "modal" | "page" | "tab";
export type GridCellDataType = "string" | "number" | "boolean" | "date" | "reference";
export type GridSearchDataType = GridCellDataType;
export type GridSearchOperation = "begins" | "contains" | "exact" | "range";
export type GridSearchSingleValue = string | number | boolean | Date | ReferenceValue | null;

export interface GridCreateContext {
	kind?: "item" | "group";
	initialValues?: Record<string, unknown>;
}

export interface GridSearchRangeValue {
	from: GridSearchSingleValue;
	to: GridSearchSingleValue;
}

export type GridSearchValue = GridSearchSingleValue | GridSearchRangeValue;
export type GridSearchRangeBound = "from" | "to";

export interface GridSearchValueContext {
	field: string;
	searchField: string;
	dataType: GridSearchDataType;
	operation: GridSearchOperation;
	bound?: GridSearchRangeBound;
}

export type GridRowClass =
	| string
	| string[]
	| Record<string, boolean>
	| null
	| undefined;

export type GridRowClassResolver<TModel extends object> = (
	row: TModel,
) => GridRowClass;

export interface CollectionGridApi<
	TListModel,
	TKey,
	TNew,
	TUpd,
	TDetailModel = TListModel,
> {
	serviceName?: string;
	list: (
		params?: CollectionParams,
	) => Promise<CollectionResponse<TListModel> | void>;
	detail?: (key: TKey) => Promise<TDetailModel>;
	create?: (model: TNew) => Promise<TKey>;
	update?: (key: TKey, model: TUpd) => Promise<unknown>;
	delete?: (key: TKey) => Promise<unknown>;
}

export interface GridFooterConfig<TModel extends object> {
	label?: string;
	aggKey?: string;
	calc?: (
		rows: TModel[],
		agg: Record<string, unknown>,
	) => unknown;
}

export interface GridColumn<TModel extends object> {
	field: keyof TModel & string;
	headerKey: string;
	header?: string;
	sortable?: boolean;
	sortField?: string;
	editable?: boolean;
	dataType?: GridCellDataType;
	/** Props forwarded to the built-in inline editor component. */
	editorProps?: Record<string, unknown>;
	/**
	 * Normalizes a raw inline-editor value before it is assigned to the row.
	 * Useful for null handling, rounding, trimming, and similar field-local rules.
	 */
	normalizeValue?: (value: unknown, row: TModel) => unknown;
	/**
	 * Runs after the common inline-edit path assigns the edited field.
	 *
	 * The row is the reactive inline-edit draft. The normalized field value
	 * is already present when this hook runs, so it normally only contains
	 * dependent-field business logic. Mutating sibling fields immediately
	 * updates their editors. Async hooks are supported.
	 */
	setValue?: (row: TModel, value: unknown) => void | Promise<void>;
	/** Reference definition used by built-in reference body/editor rendering. */
	reference?: CrudReferenceDefinition<any, any, any>;
	/** Sibling read-projection field containing { keys, descr }. Never submitted. */
	referenceField?: keyof TModel & string;
	searchable?: boolean;
	searchField?: string;
	searchDataType?: GridSearchDataType;
	searchReferenceKeys?: Record<string, string>;
	searchReferenceAutocomplete?: ReferenceAutocompleteConfig<any, ReferenceKeys>;
	searchReferenceOpenAction?: ReferenceRouteAction<ReferenceValue<ReferenceKeys>>;
	searchReferenceSelectAction?: ReferenceSelectAction;
	searchOperations?: GridSearchOperation[];
	searchComponent?: Component | string;
	searchComponentProps?: Record<string, unknown>;
	/**
	 * Date columns are searched as a whole local calendar day by default.
	 * Set to false when the server expects exact datetime values.
	 */
	searchDateOnly?: boolean;
	/** Converts a UI search value to the raw server filter value. Useful for masked values like phones. */
	searchValueToFilter?: (
		value: GridSearchSingleValue,
		context: GridSearchValueContext,
	) => unknown;
	/** Formats a search chip label. Useful when the server value is raw but the UI is masked. */
	searchValueLabel?: (
		value: GridSearchValue,
		context: GridSearchValueContext,
	) => string;
	width?: string;
	style?: string;
	bodyClass?: string | GridRowClassResolver<TModel>;
	align?: "left" | "center" | "right";
	footer?: GridFooterConfig<TModel>;
	format?: (
		value: unknown,
		row: TModel,
	) => string;
}


export interface GridSearchColumnOption {
	field: string;
	header: string;
	searchField: string;
	dataType: GridSearchDataType;
	operations: GridSearchOperation[];
	referenceKeys?: Record<string, string>;
	referenceAutocomplete?: ReferenceAutocompleteConfig<any, ReferenceKeys>;
	referenceOpenAction?: ReferenceRouteAction<ReferenceValue<ReferenceKeys>>;
	referenceSelectAction?: ReferenceSelectAction;
	searchComponent?: Component | string;
	searchComponentProps?: Record<string, unknown>;
	searchDateOnly?: boolean;
	searchValueToFilter?: (
		value: GridSearchSingleValue,
		context: GridSearchValueContext,
	) => unknown;
	searchValueLabel?: (
		value: GridSearchValue,
		context: GridSearchValueContext,
	) => string;
}

export interface GridSearchInput {
	field: string;
	operation: GridSearchOperation;
	value: GridSearchValue;
}

export interface GridSearchCriterion {
	id: string;
	field: string;
	label: string;
	operation: GridSearchOperation;
	operationLabel: string;
	value: GridSearchValue;
	valueLabel: string;
	filter: CollectionFilter;
	filters?: CollectionFilter[];
	removable?: boolean;
}

export interface GridCommandContext<TModel extends object, TKey = unknown> {
	name: GridCommandName;
	createContext?: GridCreateContext;
	row: TModel | null;
	rows: TModel[];
	keys: TKey[];
	selectedRow: TModel | null;
	selectedCell: GridCellPosition<TModel> | null;
	selectedColumn: GridColumn<TModel> | null;
	markedRows: TModel[];
	clearMarkedRows: () => void;
	reload: () => Promise<void>;
}

export type GridCommandHandler<TModel extends object, TKey = unknown> = (
	context: GridCommandContext<TModel, TKey>,
) => void | Promise<void>;

export interface GridCommand<
	TModel extends object = Record<string, unknown>,
	TKey = unknown,
> {
	name: GridCommandName;
	labelKey?: string;
	label?: string;
	icon?: string;
	picture?: string;
	iconOnly?: boolean;
	shortcut?: string;
	severity?: "secondary" | "success" | "info" | "warn" | "danger" | "contrast";
	visible?: boolean | ((row: TModel | null) => boolean);
	enabled?: boolean | ((row: TModel | null) => boolean);
	handler?: GridCommandHandler<TModel, TKey>;
	/**
	 * If true, the grid runs its built-in command after the custom handler.
	 * By default a handler fully overrides a command.
	 */
	runDefault?: boolean;
}

export interface GridCommandRuntime<
	TModel extends object = Record<string, unknown>,
	TKey = unknown,
> extends GridCommand<TModel, TKey> {
	label: string;
	disabled: boolean;
}

export interface GridCellPosition<TModel extends object> {
	rowIndex: number;
	columnIndex: number;
	field: keyof TModel & string;
	row: TModel;
}

export interface GridRouteConfig<TModel extends object> {
	create?: RouteLocationRaw | ((context: GridCreateContext) => RouteLocationRaw);
	edit?: RouteLocationRaw | ((row: TModel) => RouteLocationRaw);
	copy?: RouteLocationRaw | ((row: TModel) => RouteLocationRaw);
}

export type GridHierarchyConfig<TModel extends object> = CollectionHierarchyConfig<TModel>;

export interface SavedGridState {
	version: number;
	first: number;
	rowsPerPage: number;
	sorter: CollectionSorter[];
	selectedKey?: string;
	markedKeys?: string[];
	markAnchorKey?: string;
	selectedCell?: {
		rowIndex: number;
		columnIndex: number;
	};
	searchCriteria?: GridSearchCriterion[];
}

export interface GridCommandEvent<TModel extends object, TKey = unknown> {
	name: GridCommandName;
	createContext?: GridCreateContext;
	row: TModel | null;
	rows: TModel[];
	keys: TKey[];
}

export interface GridDeleteEvent<TModel extends object, TKey> {
	rows: TModel[];
	keys: TKey[];
}

export interface CollectionGridExpose {
	load: () => Promise<void>;
	focus: () => Promise<void>;
	clearMarkedRows: () => void;
	getMarkedRows: () => object[];
	getCurrentCell: () => GridCellPosition<any> | null;
	getCurrentColumn: () => GridColumn<any> | null;
	clearSearch: () => Promise<void>;
}
