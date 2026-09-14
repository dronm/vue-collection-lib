export type CollectionHierarchyViewMode = "hierarchy" | "flat";
export type CollectionHierarchySelectable = "items" | "groups" | "all";
export type CollectionHierarchyRowClass =
	| string
	| string[]
	| Record<string, boolean>
	| null
	| undefined;
export type CollectionHierarchyRowClassResolver<TModel extends object> = (
	row: TModel,
) => CollectionHierarchyRowClass;

export interface CollectionHierarchyBreadcrumb {
	id: unknown;
	label: string;
}

export interface CollectionHierarchyConfig<TModel extends object> {
	/** Field containing the parent group ID. Defaults to parent_id. */
	parentField?: string;
	/** Field identifying group rows. Defaults to is_group. */
	groupField?: string;
	/** Field containing the hierarchy ID. Defaults to the CollectionGrid dataKey. */
	idField?: string;
	/** Field used for breadcrumb text. Defaults to name. */
	labelField?: string;
	getId?: (row: TModel) => unknown;
	getLabel?: (row: TModel) => string;
	isGroup?: (row: TModel) => boolean;
	defaultViewMode?: CollectionHierarchyViewMode;
	allowFlatView?: boolean;
	groupsFirst?: boolean;
	/** Reference-picking eligibility. Defaults to items. */
	selectable?: CollectionHierarchySelectable | ((row: TModel) => boolean);
	rootLabel?: string;
	rootLabelKey?: string;
	groupIcon?: string;
	openGroupIcon?: string;
	flatGroupIcon?: string;
	itemIcon?: string;
	hierarchyModeIcon?: string;
	flatModeIcon?: string;
	createGroupIcon?: string;
	createItemLabel?: string;
	createItemLabelKey?: string;
	createGroupLabel?: string;
	createGroupLabelKey?: string;
	showFlatLabel?: string;
	showFlatLabelKey?: string;
	showHierarchyLabel?: string;
	showHierarchyLabelKey?: string;
	groupRowClass?: CollectionHierarchyRowClass | CollectionHierarchyRowClassResolver<TModel>;
	itemRowClass?: CollectionHierarchyRowClass | CollectionHierarchyRowClassResolver<TModel>;
}
