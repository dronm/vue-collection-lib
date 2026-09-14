import type { CollectionParams, CollectionSorter } from "./collection";
import type {
	CollectionGridApi,
	GridColumn,
	GridCommand,
	GridCreateContext,
	GridEditMode,
	GridHierarchyConfig,
	GridRouteConfig,
} from "../components/crudGrid/types";

export interface CollectionDefinition<
	TModel extends object,
	TKey,
	TNew = unknown,
	TUpd extends object = Record<string, unknown>,
	TDetailModel = TModel,
> {
	titleKey: string;
	api: CollectionGridApi<TModel, TKey, TNew, TUpd, TDetailModel>;
	columns: GridColumn<TModel>[];
	dataKey: string;
	getKey: (row: TModel) => TKey;
	routes?: GridRouteConfig<TModel>;
	commands?: GridCommand<TModel, TKey>[];
	editMode?: GridEditMode;
	createRow?: (context?: GridCreateContext) => TModel;
	createModel?: (row: TModel) => TNew;
	baseParams?: CollectionParams;
	defaultSorter?: CollectionSorter[];
	hierarchy?: GridHierarchyConfig<TModel>;
	stateKey?: string;
	pageSize?: number;
	showCommandShortcuts?: boolean;
}

export const defineCollection = <
	TModel extends object,
	TKey,
	TNew = unknown,
	TUpd extends object = Record<string, unknown>,
	TDetailModel = TModel,
>(
	definition: CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel>,
): CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel> => definition;
