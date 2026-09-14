<script setup lang="ts" generic="TModel extends object, TKey, TNew, TUpd extends object, TDetailModel = TModel">
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	shallowRef,
	watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Column, {
	type ColumnPassThroughMethodOptions,
	type ColumnPassThroughOptions,
} from "primevue/column";
import DataTable, { type DataTableSortEvent } from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";

import ReferenceKeyInput from "../reference/ReferenceKeyInput.vue";
import ReferenceKeyLabel from "../reference/ReferenceKeyLabel.vue";

import { useWSManager } from "../../api/wsProvider";
import {
	SortDirect,
	type CollectionParams,
	type CollectionSorter,
} from "../../types/collection";
import { errorText } from "../../utils/errorText";
import { useCollectionGrid } from "../../composables/useCollectionGrid";
import { useCollectionHierarchy } from "../../composables/useCollectionHierarchy";
import {
	findCommandByShortcut,
	resolveGridCommands,
} from "../../composables/useGridCommands";
import CollectionBreadcrumbs from "./CollectionBreadcrumbs.vue";
import GridCommandPanel from "./GridCommandPanel.vue";
import GridSearchDialog from "./GridSearchDialog.vue";
import GridSearchPanel from "./GridSearchPanel.vue";
import {
	focusGridElementWithoutScroll,
	readGridScrollPosition,
	type GridScrollPosition,
} from "./focusUtils";
import {
	applyGridInlineValue,
	getReactiveGridEditRow,
} from "./inlineEditing";
import {
	cloneGridRow,
	formatGridValue,
	makeChangedModel,
	makeCreateModel,
} from "./gridUtils";
import {
	makeReferenceSelectionMessage,
	referenceSelectionChannelName,
	referenceSelectionTokenFromQuery,
} from "../../utils/referenceSelection";
import {
	buildSearchColumnOptions,
	buildSearchCriterion,
} from "./gridSearchUtils";
import type {
	CollectionGridApi,
	CollectionGridExpose,
	GridCellPosition,
	GridColumn,
	GridCommand,
	GridCommandContext,
	GridCommandEvent,
	GridCommandListMode,
	GridCommandRuntime,
	GridCreateContext,
	GridDeleteEvent,
	GridEditMode,
	GridHierarchyConfig,
	GridRowClass,
	GridRowClassResolver,
	GridRouteConfig,
	GridSearchCriterion,
	GridSearchInput,
} from "./types";

type ContextMenuItem = {
	label: string;
	icon?: string;
	disabled?: boolean;
	command: GridCommandRuntime<TModel, TKey>;
};

const props = withDefaults(defineProps<{
	api: CollectionGridApi<TModel, TKey, TNew, TUpd, TDetailModel>;
	columns: GridColumn<TModel>[];
	dataKey: string;
	getKey: (row: TModel) => TKey;
	getRowClass?: GridRowClassResolver<TModel>;
	stateKey?: string;
	baseParams?: CollectionParams;
	pageSize?: number;
	rowsPerPageOptions?: number[];
	defaultSorter?: CollectionSorter[];
	commands?: GridCommand<TModel, TKey>[];
	commandsMode?: GridCommandListMode;
	contextCommands?: GridCommand<TModel, TKey>[];
	contextCommandsMode?: GridCommandListMode;
	showContextMenu?: boolean;
	editMode?: GridEditMode;
	routes?: GridRouteConfig<TModel>;
	/**
	 * Creates a fresh list-model draft for native inline creation.
	 * When omitted, the create command keeps its legacy emit/route behavior.
	 */
	createRow?: (context?: GridCreateContext) => TModel;
	/**
	 * Maps the edited inline draft to the API create payload.
	 * Defaults to all editable grid columns.
	 */
	createModel?: (row: TModel) => TNew;
	hierarchy?: GridHierarchyConfig<TModel>;
	rowSelection?: boolean;
	showCommandPanel?: boolean;
	showCommandShortcuts?: boolean;
	autoDelete?: boolean;
	confirmDelete?: boolean;
	eventService?: string;
	autoRefreshOnCrud?: boolean;
	eventRefreshDelay?: number;
}>(), {
	pageSize: 20,
	rowsPerPageOptions: () => [20, 50, 100],
	editMode: "modal",
	rowSelection: false,
	showCommandPanel: true,
	showCommandShortcuts: true,
	commandsMode: "replace",
	contextCommandsMode: "replace",
	showContextMenu: true,
	autoDelete: true,
	confirmDelete: true,
	autoRefreshOnCrud: true,
	eventRefreshDelay: 100,
});

const emit = defineEmits<{
	command: [event: GridCommandEvent<TModel, TKey>];
	create: [context?: GridCreateContext];
	edit: [row: TModel];
	copy: [row: TModel];
	delete: [event: GridDeleteEvent<TModel, TKey>];
	refresh: [];
	selectionChange: [row: TModel | null];
	cellChange: [cell: GridCellPosition<TModel> | null];
	rowCreate: [payload: {
		key: TKey;
		model: TNew;
		row: TModel;
	}];
	rowUpdate: [payload: {
		key: TKey;
		model: TUpd;
		row: TModel;
	}];
}>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const wsManager = useWSManager();
const activeContextMenuItems = ref<ContextMenuItem[]>([]);
const contextMenuState = ref({
	visible: false,
	x: 0,
	y: 0,
});
const contextMenuOpenedAt = ref(0);
const CONTEXT_MENU_CLOSE_GUARD_MS = 250;
const deleteConfirmVisible = ref(false);
const deletePendingRows = ref<TModel[]>([]);
const deleteRunning = ref(false);

const contextMenuStyle = computed(() => {
	return {
		position: "fixed",
		left: `${contextMenuState.value.x}px`,
		top: `${contextMenuState.value.y}px`,
		zIndex: "2147483647",
		minWidth: "12rem",
		maxWidth: "24rem",
		overflow: "hidden",
		border: "1px solid rgb(229 231 235)",
		borderRadius: "0.5rem",
		background: "white",
		color: "rgb(17 24 39)",
		boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
		padding: "0.25rem",
		pointerEvents: "auto",
	} as const;
});

const searchDialogVisible = ref(false);
const editingSearchCriterion = ref<GridSearchCriterion | null>(null);
const searchInitialField = ref<string | null>(null);
const searchInitialValue = ref<string | null>(null);
const editingRows = shallowRef<TModel[]>([]);
const inlineCreateRow = shallowRef<TModel | null>(null);
const inlineCreateContext = shallowRef<GridCreateContext | undefined>(undefined);
const inlineCreatePreviousSelection = shallowRef<{
	row: TModel | null;
	columnIndex: number | null;
} | null>(null);
const originalRows = new WeakMap<TModel, TModel>();
const rootEl = ref<HTMLElement | null>(null);
const pointerScrollPosition = ref<GridScrollPosition | null>(null);

const referenceSelectionToken = computed(() => {
	return referenceSelectionTokenFromQuery(route.query);
});

const referenceSelectionMode = computed(() => {
	return referenceSelectionToken.value !== null;
});

const inlineEditing = computed(() => {
	return props.editMode === "inline" && editingRows.value.length > 0;
});

const effectiveRowSelection = computed(() => {
	return props.rowSelection || referenceSelectionMode.value;
});

const columnsRef = computed(() => props.columns);
const hierarchyConfigRef = computed(() => props.hierarchy);
const dataKeyRef = computed(() => props.dataKey);
const stateKeyRef = computed(() => props.stateKey);
const hierarchy = useCollectionHierarchy<TModel>({
	config: hierarchyConfigRef,
	dataKey: dataKeyRef,
	stateKey: stateKeyRef,
});

const baseParamsRef = computed<CollectionParams | undefined>(() => {
	const external = props.baseParams;
	const hierarchical = hierarchy.baseParams.value;

	if (!external) {
		return hierarchical;
	}

	if (!hierarchical) {
		return external;
	}

	return {
		...external,
		...hierarchical,
		filter: [
			...(external.filter ?? []),
			...(hierarchical.filter ?? []),
		],
		sorter: [
			...(hierarchical.sorter ?? []),
			...(external.sorter ?? []),
		],
	};
});

const grid = useCollectionGrid<TModel, TKey, TNew, TUpd, TDetailModel>({
	api: props.api,
	columns: columnsRef,
	getKey: props.getKey,
	stateKey: props.stateKey,
	baseParams: baseParamsRef,
	pageSize: props.pageSize,
	rowSelection: effectiveRowSelection.value,
	defaultSorter: props.defaultSorter,
});

const searchableColumns = computed(() => {
	return buildSearchColumnOptions(props.columns, t);
});

const currentSearchField = computed(() => {
	if (effectiveRowSelection.value || grid.selectedCell.value === null) {
		return null;
	}

	const field = grid.selectedCell.value.field;
	return searchableColumns.value.some((column) => column.field === field)
		? field
		: null;
});

const hierarchyText = (
	value: string | undefined,
	key: string | undefined,
	fallbackKey: string,
): string => {
	return value ?? t(key ?? fallbackKey);
};

const visibleCommands = computed(() => {
	let commands = resolveGridCommands<TModel, TKey>(
		props.commands,
		grid.selectedRow.value,
		t,
		props.commandsMode,
	);

	if (hierarchy.enabled.value) {
		const createIndex = commands.findIndex((command) => command.name === "create");
		if (createIndex >= 0) {
			const createCommand = commands[createIndex];
			const configuredCreateCommand = props.commands?.find((command) => command.name === "create");
			const hasConfiguredCreateLabel = configuredCreateCommand?.label !== undefined
				|| configuredCreateCommand?.labelKey !== undefined;

			if (createCommand && !hasConfiguredCreateLabel) {
				commands[createIndex] = {
					...createCommand,
					label: hierarchyText(
						props.hierarchy?.createItemLabel,
						props.hierarchy?.createItemLabelKey,
						"Grid.hierarchy.createItem",
					),
				};
			}

			if (!commands.some((command) => command.name === "createGroup")) {
				commands.splice(createIndex + 1, 0, {
					name: "createGroup",
					label: hierarchyText(
						props.hierarchy?.createGroupLabel,
						props.hierarchy?.createGroupLabelKey,
						"Grid.hierarchy.createGroup",
					),
					icon: props.hierarchy?.createGroupIcon ?? "pi pi-folder-plus",
					disabled: createCommand?.disabled ?? false,
				});
			}
		}

		if (hierarchy.allowFlatView.value && !commands.some((command) => command.name === "toggleHierarchyView")) {
			const hierarchyMode = hierarchy.viewMode.value === "hierarchy";
			commands.push({
				name: "toggleHierarchyView",
				label: hierarchyMode
					? hierarchyText(
						props.hierarchy?.showFlatLabel,
						props.hierarchy?.showFlatLabelKey,
						"Grid.hierarchy.showFlat",
					)
					: hierarchyText(
						props.hierarchy?.showHierarchyLabel,
						props.hierarchy?.showHierarchyLabelKey,
						"Grid.hierarchy.showHierarchy",
					),
				icon: hierarchyMode
					? props.hierarchy?.flatModeIcon ?? "pi pi-list"
					: props.hierarchy?.hierarchyModeIcon ?? "pi pi-sitemap",
				iconOnly: true,
				disabled: false,
			});
		}
	}

	if (referenceSelectionMode.value) {
		commands = commands.filter((command) => {
			return command.name === "search"
				|| command.name === "refresh"
				|| command.name === "toggleHierarchyView";
		});
	}

	if (inlineEditing.value) {
		commands = commands.map((command) => ({
			...command,
			disabled: true,
		}));
	}

	return commands;
});

const buildContextMenuItems = (row: TModel | null): ContextMenuItem[] => {
	if (!props.showContextMenu || referenceSelectionMode.value || inlineEditing.value) {
		return [];
	}

	const contextCommands = props.contextCommands ?? props.commands;
	const mode = props.contextCommands === undefined
		? props.commandsMode
		: props.contextCommandsMode;

	return resolveGridCommands<TModel, TKey>(
		contextCommands,
		row,
		t,
		mode,
	).map((command) => {
		const label = command.shortcut
			? `${command.label} (${command.shortcut})`
			: command.label;

		return {
			label,
			icon: command.icon,
			disabled: command.disabled,
			command,
		};
	});
};

const paginatorTemplate = "FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown";

const pt = {
	column: {
		bodycell: ({ state }: { state: Record<string, unknown> }) => ({
			class: state["d_editing"] ? "!p-1" : "!p-0",
		}),
	},
};

const normalizeRowClass = (
	value: GridRowClass,
): string[] => {
	if (!value) {
		return [];
	}

	if (typeof value === "string") {
		return value.split(" ").filter((item) => item.length > 0);
	}

	if (Array.isArray(value)) {
		return value.filter((item) => item.length > 0);
	}

	return Object.entries(value)
		.filter(([, enabled]) => enabled)
		.map(([className]) => className);
};

const resolveRowClass = (row: TModel): string => {
	const classes: string[] = [
		...normalizeRowClass(props.getRowClass?.(row)),
		...normalizeRowClass(hierarchy.rowClass(row)),
	];

	if (hierarchy.enabled.value) {
		classes.push(
			hierarchy.isGroup(row)
				? "crud-grid-row-group"
				: "crud-grid-row-item",
		);
	}

	if (inlineCreateRow.value === row) {
		classes.push("crud-grid-row-new");
	}

	if (grid.isRowMarked(row)) {
		classes.push("crud-grid-row-marked");
	}

	if (effectiveRowSelection.value && grid.selectedRow.value === row) {
		classes.push("crud-grid-row-current");
	}

	if (referenceSelectionMode.value) {
		classes.push(
			hierarchy.enabled.value && !hierarchy.isSelectable(row)
				? "crud-grid-row-not-selectable"
				: "crud-grid-row-selectable",
		);
	}

	return classes.join(" ");
};

const load = async (): Promise<void> => {
	await grid.load();
};

watch(
	() => props.baseParams,
	() => {
		grid.setPage(0, grid.rowsPerPage.value);
		grid.selectRow(null);
		void load().catch((err: unknown) => {
			console.error("Failed to reload collection after base params changed", err);
		});
	},
	{ deep: true },
);

const hierarchyRootLabel = computed(() => {
	return props.hierarchy?.rootLabel
		?? t(props.hierarchy?.rootLabelKey ?? "Grid.hierarchy.root");
});

const navigateHierarchyBreadcrumb = async (displayIndex: number): Promise<void> => {
	if (
		inlineEditing.value
		|| !hierarchy.enabled.value
		|| hierarchy.viewMode.value !== "hierarchy"
	) {
		return;
	}

	hierarchy.goToBreadcrumb(displayIndex);
	grid.setPage(0, grid.rowsPerPage.value);
	grid.selectRow(null);
	await load();
};

const onHierarchyIconClick = async (
	event: MouseEvent,
	row: TModel,
): Promise<void> => {
	if (
		inlineEditing.value
		|| hierarchy.viewMode.value !== "hierarchy"
		|| !hierarchy.isGroup(row)
	) {
		return;
	}

	event.stopPropagation();
	if (!hierarchy.enterGroup(row)) {
		return;
	}

	grid.setPage(0, grid.rowsPerPage.value);
	grid.selectRow(null);
	await load();
};

const canSelectCurrentReferenceRow = computed(() => {
	const row = grid.selectedRow.value;
	return row !== null
		&& (!hierarchy.enabled.value || hierarchy.isSelectable(row));
});

const crudEventService = computed(() => {
	const serviceName = props.eventService ?? props.api.serviceName;
	const normalized = serviceName?.trim() ?? "";

	return normalized === "" ? null : normalized;
});

let crudSubscriptionId: string | null = null;
let eventRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let eventRefreshPending = false;
let subscribedWhileConnected = false;

const clearEventRefreshTimer = (): void => {
	if (eventRefreshTimer === null) {
		return;
	}

	clearTimeout(eventRefreshTimer);
	eventRefreshTimer = null;
};

const scheduleEventRefresh = (): void => {
	if (inlineEditing.value) {
		eventRefreshPending = true;
		clearEventRefreshTimer();
		return;
	}

	eventRefreshPending = false;
	clearEventRefreshTimer();
	eventRefreshTimer = setTimeout(() => {
		eventRefreshTimer = null;

		if (inlineEditing.value) {
			eventRefreshPending = true;
			return;
		}

		if (grid.loading.value) {
			scheduleEventRefresh();
			return;
		}

		void load().catch((error: unknown) => {
			console.error("Failed to refresh collection after CRUD event", error);
		});
	}, props.eventRefreshDelay);
};

watch(inlineEditing, (editing) => {
	if (!editing && eventRefreshPending) {
		scheduleEventRefresh();
	}
});

const subscribeToCrudEvents = (): void => {
	if (
		wsManager === null
		|| !props.autoRefreshOnCrud
		|| crudEventService.value === null
	) {
		return;
	}

	const serviceName = crudEventService.value;
	subscribedWhileConnected = wsManager.isConnected();
	crudSubscriptionId = wsManager.subscribe({
		events: [
			`${serviceName}.Create`,
			`${serviceName}.Update`,
			`${serviceName}.Delete`,
		],
		onEvent: scheduleEventRefresh,
		onOpen: () => {
			if (subscribedWhileConnected) {
				scheduleEventRefresh();
			}

			subscribedWhileConnected = true;
		},
	});
};

const unsubscribeFromCrudEvents = (): void => {
	eventRefreshPending = false;
	clearEventRefreshTimer();

	if (wsManager !== null && crudSubscriptionId !== null) {
		wsManager.unsubscribe(crudSubscriptionId);
	}

	crudSubscriptionId = null;
};

const pageChanged = async (event: {
	first: number;
	rows: number;
}): Promise<void> => {
	if (inlineEditing.value) {
		return;
	}

	grid.setPage(event.first, event.rows);
	await load();
};

const normalizeSortField = (field: unknown): string | null => {
	return typeof field === "string" ? field : null;
};

const normalizeSortDirection = (order: unknown): SortDirect | null => {
	if (order === 1) {
		return SortDirect.ASC;
	}

	if (order === -1) {
		return SortDirect.DESC;
	}

	return null;
};

const sortChanged = async (event: DataTableSortEvent): Promise<void> => {
	if (inlineEditing.value) {
		return;
	}

	const nextSorter: CollectionSorter[] = [];

	if (event.multiSortMeta?.length) {
		event.multiSortMeta.forEach((item) => {
			const field = normalizeSortField(item.field);
			const direction = normalizeSortDirection(item.order);

			if (field === null || direction === null) {
				return;
			}

			nextSorter.push({
				f: field,
				d: direction,
			});
		});
	} else {
		const field = normalizeSortField(event.sortField);
		const direction = normalizeSortDirection(event.sortOrder);

		if (field !== null && direction !== null) {
			nextSorter.push({
				f: field,
				d: direction,
			});
		}
	}

	grid.setSorter(nextSorter);
	await load();
};

const getScrollViewport = (): Window | null => {
	return typeof window === "undefined" ? null : window;
};

const focusGridRootWithoutScroll = (
	position: GridScrollPosition | null = pointerScrollPosition.value,
): void => {
	focusGridElementWithoutScroll(
		rootEl.value,
		getScrollViewport(),
		position,
	);
};

const capturePrimaryPointerScroll = (event: PointerEvent | MouseEvent): void => {
	if (event.button !== 0) {
		return;
	}

	const viewport = getScrollViewport();
	if (viewport === null) {
		return;
	}

	pointerScrollPosition.value = readGridScrollPosition(viewport);
};

const clearPointerScrollPosition = (): void => {
	pointerScrollPosition.value = null;
};

const GRID_INTERACTIVE_TARGET_SELECTOR = [
	"a[href]",
	"button",
	"input",
	"select",
	"textarea",
	"summary",
	"[contenteditable]:not([contenteditable='false'])",
	"[role='textbox']",
	"[role='spinbutton']",
	"[role='button']",
	"[role='checkbox']",
	"[role='combobox']",
	"[role='link']",
	"[role='radio']",
	"[role='switch']",
].join(",");

const isInteractiveGridTarget = (target: EventTarget | null): boolean => {
	return target instanceof Element
		&& target.closest(GRID_INTERACTIVE_TARGET_SELECTOR) !== null;
};

const isGridDataRowTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element) || rootEl.value === null) {
		return false;
	}

	const row = target.closest("tbody > tr");
	return row !== null && rootEl.value.contains(row);
};

const onRowClick = (event: {
	originalEvent?: Event;
	data: TModel;
}): void => {
	const mouseEvent = event.originalEvent instanceof MouseEvent
		? event.originalEvent
		: null;
	focusGridRootWithoutScroll();

	if (referenceSelectionMode.value) {
		grid.selectRow(event.data);
		emit("selectionChange", event.data);
		return;
	}

	if (mouseEvent?.shiftKey) {
		grid.selectRow(event.data, {
			resetMarkAnchor: false,
		});
		grid.markRangeToRow(event.data, mouseEvent.ctrlKey || mouseEvent.metaKey);
		emit("selectionChange", event.data);
		return;
	}

	if (mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
		grid.selectRow(event.data);
		grid.toggleRowMark(event.data);
		emit("selectionChange", event.data);
		return;
	}

	if (grid.markedRows.value.length > 0) {
		grid.clearMarkedRows();
	}

	grid.selectRow(event.data);
	emit("selectionChange", event.data);
};

const onCellClick = (
	row: TModel,
	rowIndex: number,
	columnIndex: number,
): void => {
	if (effectiveRowSelection.value) {
		return;
	}

	grid.selectCell(row, rowIndex, columnIndex);
	focusGridRootWithoutScroll();
	emit("cellChange", grid.selectedCell.value);
};

const isSelectedCell = (
	rowIndex: number,
	columnIndex: number,
): boolean => {
	return grid.selectedCell.value?.rowIndex === rowIndex
		&& grid.selectedCell.value?.columnIndex === columnIndex;
};

const resolveConfiguredBodyClass = (
	column: GridColumn<TModel>,
	row: TModel,
): string[] => {
	if (!column.bodyClass) {
		return [];
	}

	if (typeof column.bodyClass === "function") {
		return normalizeRowClass(column.bodyClass(row));
	}

	return normalizeRowClass(column.bodyClass);
};

const resolveCellPassThrough = (
	column: GridColumn<TModel>,
	columnIndex: number,
): ColumnPassThroughOptions => {
	return {
		bodyCell: (options: ColumnPassThroughMethodOptions) => {
			const row = options.parent?.props?.rowData as TModel | undefined;
			const rowIndex = options.parent?.props?.rowIndex as number | undefined;
			const classes = row
				? resolveConfiguredBodyClass(column, row)
				: [];

			if (
				!effectiveRowSelection.value
				&& typeof rowIndex === "number"
				&& isSelectedCell(rowIndex, columnIndex)
			) {
				classes.push("crud-grid-cell-current");
			}

			return classes.length > 0
				? { class: classes.join(" ") }
				: {};
		},
	};
};

const openSearchDialog = (
	criterion?: GridSearchCriterion | null,
	initialValue?: string | null,
): void => {
	editingSearchCriterion.value = criterion ?? null;
	const currentColumn = searchableColumns.value.find((column) => {
		return column.field === currentSearchField.value;
	});

	searchInitialField.value = criterion
		? criterion.field
		: currentColumn?.field ?? currentSearchField.value;
	searchInitialValue.value = criterion ? null : initialValue ?? null;
	searchDialogVisible.value = true;
};

const applySearch = async (input: GridSearchInput): Promise<void> => {
	const criterion = buildSearchCriterion(
		input,
		searchableColumns.value,
		t,
		editingSearchCriterion.value?.id,
	);

	if (!criterion) {
		return;
	}

	grid.upsertSearchCriterion(criterion);
	searchDialogVisible.value = false;
	editingSearchCriterion.value = null;
	await load();
};

const openSearchCriterion = (id: string): void => {
	const criterion = grid.searchCriteria.value.find((item) => item.id === id);

	if (!criterion) {
		return;
	}

	openSearchDialog(criterion);
};

const removeSearchCriterion = async (id: string): Promise<void> => {
	grid.removeSearchCriterion(id);
	await load();
};

const clearSearch = async (): Promise<void> => {
	grid.clearSearchCriteria();
	await load();
};

const closeContextMenu = (): void => {
	contextMenuState.value.visible = false;
};

const shouldIgnoreImmediateContextMenuClose = (): boolean => {
	return Date.now() - contextMenuOpenedAt.value < CONTEXT_MENU_CLOSE_GUARD_MS;
};

const prepareContextMenuSelection = (
	row: TModel,
	rowIndex: number | null,
	columnIndex: number | null,
): void => {
	if (!grid.isRowMarked(row) && grid.markedRows.value.length > 0) {
		grid.clearMarkedRows();
	}

	if (!effectiveRowSelection.value && rowIndex !== null && columnIndex !== null) {
		grid.selectCell(row, rowIndex, columnIndex);
		emit("cellChange", grid.selectedCell.value);
	} else {
		grid.selectRow(row);
	}

	emit("selectionChange", row);
	focusGridRootWithoutScroll();
};

const openContextMenu = (
	event: MouseEvent,
	row: TModel,
	rowIndex: number | null,
	columnIndex: number | null,
): void => {
	if (inlineEditing.value) {
		if (event.cancelable) {
			event.preventDefault();
		}
		event.stopPropagation();
		closeContextMenu();
		return;
	}

	if (event.cancelable) {
		event.preventDefault();
	}
	event.stopPropagation();

	prepareContextMenuSelection(row, rowIndex, columnIndex);
	activeContextMenuItems.value = buildContextMenuItems(row);
	contextMenuOpenedAt.value = Date.now();
	contextMenuState.value = {
		visible: true,
		x: event.clientX,
		y: event.clientY,
	};
};

const getColumnIndexFromElement = (target: Element): number | null => {
	const indexedElement = target.closest("[data-grid-column-index]");
	if (indexedElement !== null && rootEl.value?.contains(indexedElement)) {
		const indexRaw = indexedElement.getAttribute("data-grid-column-index");
		const index = Number(indexRaw);

		if (Number.isInteger(index) && index >= 0 && index < props.columns.length) {
			return index;
		}
	}

	return null;
};

const getRowIndexFromElement = (target: Element): number | null => {
	const indexedElement = target.closest("[data-grid-row-index]");
	if (indexedElement !== null && rootEl.value?.contains(indexedElement)) {
		const indexRaw = indexedElement.getAttribute("data-grid-row-index");
		const index = Number(indexRaw);

		if (Number.isInteger(index) && index >= 0 && index < grid.rows.value.length) {
			return index;
		}
	}

	const rowElement = target.closest("tbody > tr");
	if (rowElement === null || !rootEl.value?.contains(rowElement)) {
		return null;
	}

	const bodyElement = rowElement.parentElement;
	if (bodyElement === null) {
		return null;
	}

	const bodyRows = Array.from(bodyElement.children)
		.filter((item): item is HTMLTableRowElement => item instanceof HTMLTableRowElement);
	const index = bodyRows.indexOf(rowElement as HTMLTableRowElement);

	return index >= 0 && index < grid.rows.value.length ? index : null;
};

const resolveContextTarget = (event: MouseEvent): {
	row: TModel;
	rowIndex: number;
	columnIndex: number | null;
} | null => {
	const target = event.target instanceof Element
		? event.target
		: null;

	if (target === null || rootEl.value === null || !rootEl.value.contains(target)) {
		return null;
	}

	if (target.closest(".crud-grid-context-menu") !== null) {
		return null;
	}

	const rowIndex = getRowIndexFromElement(target);
	if (rowIndex === null) {
		return null;
	}

	const row = grid.rows.value[rowIndex];
	if (!row) {
		return null;
	}

	return {
		row,
		rowIndex,
		columnIndex: getColumnIndexFromElement(target),
	};
};

const resolveCurrentContextTarget = (): {
	row: TModel;
	rowIndex: number;
	columnIndex: number | null;
} | null => {
	const selectedCell = grid.selectedCell.value;
	if (selectedCell?.row) {
		return {
			row: selectedCell.row,
			rowIndex: selectedCell.rowIndex,
			columnIndex: selectedCell.columnIndex,
		};
	}

	const selectedRow = grid.selectedRow.value;
	if (selectedRow === null) {
		return null;
	}

	const rowIndex = grid.rows.value.indexOf(selectedRow);
	if (rowIndex < 0) {
		return null;
	}

	return {
		row: selectedRow,
		rowIndex,
		columnIndex: null,
	};
};

const eventBelongsToGrid = (event: MouseEvent | PointerEvent): boolean => {
	const target = event.target instanceof Element
		? event.target
		: null;

	return target !== null
		&& rootEl.value !== null
		&& rootEl.value.contains(target);
};

const openContextMenuFromEvent = (event: MouseEvent | PointerEvent): boolean => {
	const target = resolveContextTarget(event as MouseEvent)
		?? (eventBelongsToGrid(event) ? resolveCurrentContextTarget() : null);

	if (target === null) {
		return false;
	}

	openContextMenu(
		event as MouseEvent,
		target.row,
		target.rowIndex,
		target.columnIndex,
	);
	return true;
};

const onGridRootPointerDown = (event: PointerEvent): void => {
	if (event.button === 0 && event.isPrimary) {
		capturePrimaryPointerScroll(event);
		return;
	}

	if (event.button === 2) {
		openContextMenuFromEvent(event);
	}
};

const onGridRootMouseDown = (event: MouseEvent): void => {
	if (event.button === 0) {
		if (pointerScrollPosition.value === null) {
			capturePrimaryPointerScroll(event);
		}

		if (
			event.cancelable
			&& isGridDataRowTarget(event.target)
			&& !isInteractiveGridTarget(event.target)
		) {
			// Chromium focuses a tabindex ancestor as the default mousedown action.
			// Prevent that browser focus and apply our no-scroll focus explicitly.
			event.preventDefault();
			focusGridRootWithoutScroll();
		}
		return;
	}

	if (event.button === 2) {
		openContextMenuFromEvent(event);
	}
};

const onGridRootContextMenu = (event: MouseEvent): void => {
	if (openContextMenuFromEvent(event)) {
		return;
	}

	closeContextMenu();
};

const runContextMenuItem = (item: ContextMenuItem): void => {
	if (item.disabled) {
		return;
	}

	closeContextMenu();
	void executeCommand(item.command.name, item.command);
};

const onDocumentPointerDown = (event: PointerEvent): void => {
	if (event.button !== 2) {
		return;
	}

	if (openContextMenuFromEvent(event)) {
		return;
	}
};

const onDocumentMouseDown = (event: MouseEvent): void => {
	if (event.button === 2) {
		if (openContextMenuFromEvent(event)) {
			return;
		}

		closeContextMenu();
		return;
	}

	if (event.button !== 0 || shouldIgnoreImmediateContextMenuClose()) {
		return;
	}

	const target = event.target instanceof Element
		? event.target
		: null;

	if (target !== null && target.closest(".crud-grid-context-menu") !== null) {
		return;
	}

	closeContextMenu();
};

const onDocumentContextMenu = (event: MouseEvent): void => {
	const target = event.target instanceof Element
		? event.target
		: null;

	if (target !== null && rootEl.value?.contains(target)) {
		if (event.cancelable) {
			event.preventDefault();
		}
		event.stopPropagation();
		return;
	}

	if (!shouldIgnoreImmediateContextMenuClose()) {
		closeContextMenu();
	}
};

const onDocumentKeydown = (event: KeyboardEvent): void => {
	if (event.key === "Escape") {
		closeContextMenu();
	}
};

const onWindowResize = (): void => {
	if (!shouldIgnoreImmediateContextMenuClose()) {
		closeContextMenu();
	}
};

const onWindowScroll = (): void => {
	if (!shouldIgnoreImmediateContextMenuClose()) {
		closeContextMenu();
	}
};

onMounted(() => {
	subscribeToCrudEvents();
	document.addEventListener("pointerdown", onDocumentPointerDown, true);
	document.addEventListener("mousedown", onDocumentMouseDown, true);
	document.addEventListener("contextmenu", onDocumentContextMenu, true);
	document.addEventListener("keydown", onDocumentKeydown);
	window.addEventListener("resize", onWindowResize);
	window.addEventListener("scroll", onWindowScroll, true);
});

onBeforeUnmount(() => {
	unsubscribeFromCrudEvents();
	document.removeEventListener("pointerdown", onDocumentPointerDown, true);
	document.removeEventListener("mousedown", onDocumentMouseDown, true);
	document.removeEventListener("contextmenu", onDocumentContextMenu, true);
	document.removeEventListener("keydown", onDocumentKeydown);
	window.removeEventListener("resize", onWindowResize);
	window.removeEventListener("scroll", onWindowScroll, true);
});

const routeForCommand = (
	name: string,
	row: TModel | null,
	createContext?: GridCreateContext,
) => {
	const config = name === "create" || name === "createGroup"
		? props.routes?.create
		: name === "copy"
			? props.routes?.copy
			: props.routes?.edit;

	if (!config) {
		return null;
	}

	if (typeof config === "function") {
		const factory = config as (...args: any[]) => unknown;
		if (name === "create" || name === "createGroup") {
			return factory(createContext ?? {});
		}

		return row ? factory(row) : null;
	}

	return config;
};

const openRoute = async (
	name: string,
	row: TModel | null,
	createContext?: GridCreateContext,
): Promise<boolean> => {
	if (props.editMode !== "page" && props.editMode !== "tab") {
		return false;
	}

	const route = routeForCommand(name, row, createContext) as RouteLocationRaw | null;
	if (!route) {
		return false;
	}

	if (props.editMode === "tab") {
		const href = router.resolve(route).href;
		window.open(href, "_blank", "noopener,noreferrer");
		return true;
	}

	await router.push(route);
	return true;
};

const startInlineEdit = (row: TModel | null): boolean => {
	if (props.editMode !== "inline" || row === null) {
		return false;
	}

	if (editingRows.value.length > 0) {
		return editingRows.value.includes(row);
	}

	originalRows.set(row, cloneGridRow(row));
	editingRows.value = [row];
	return true;
};

const restoreSelectionAfterInlineCreate = (): void => {
	const previous = inlineCreatePreviousSelection.value;
	inlineCreatePreviousSelection.value = null;

	if (previous?.row && grid.rows.value.includes(previous.row)) {
		if (effectiveRowSelection.value || previous.columnIndex === null) {
			grid.selectRow(previous.row);
		} else {
			grid.selectCell(
				previous.row,
				grid.rows.value.indexOf(previous.row),
				previous.columnIndex,
			);
		}
		return;
	}

	const firstRow = grid.rows.value[0] ?? null;
	if (firstRow === null) {
		grid.selectRow(null);
		return;
	}

	if (effectiveRowSelection.value) {
		grid.selectRow(firstRow);
		return;
	}

	const firstEditableColumn = props.columns.findIndex((column) => column.editable);
	grid.selectCell(firstRow, 0, Math.max(firstEditableColumn, 0));
};

const discardInlineCreate = (): void => {
	const row = inlineCreateRow.value;
	if (row === null) {
		return;
	}

	grid.rows.value = grid.rows.value.filter((item) => item !== row);
	editingRows.value = editingRows.value.filter((item) => item !== row);
	originalRows.delete(row);
	inlineCreateRow.value = null;
	inlineCreateContext.value = undefined;
	restoreSelectionAfterInlineCreate();
};

const startInlineCreate = async (
	createContext?: GridCreateContext,
): Promise<boolean> => {
	if (
		props.editMode !== "inline"
		|| !props.api.create
		|| !props.createRow
		|| editingRows.value.length > 0
	) {
		return false;
	}

	grid.error.value = null;
	const row = props.createRow(createContext);
	if (createContext?.initialValues) {
		Object.assign(row, createContext.initialValues);
	}
	inlineCreatePreviousSelection.value = {
		row: grid.selectedRow.value,
		columnIndex: grid.selectedCell.value?.columnIndex ?? null,
	};
	inlineCreateRow.value = row;
	inlineCreateContext.value = createContext;
	grid.rows.value = [row, ...grid.rows.value];
	originalRows.set(row, cloneGridRow(row));
	editingRows.value = [row];

	const firstEditableColumn = props.columns.findIndex((column) => column.editable);
	if (effectiveRowSelection.value || firstEditableColumn < 0) {
		grid.selectRow(row);
	} else {
		grid.selectCell(row, 0, firstEditableColumn);
	}

	await nextTick();
	return true;
};

const getCommandTargetRows = (row: TModel | null): TModel[] => {
	if (grid.markedRows.value.length > 0) {
		return [...grid.markedRows.value];
	}

	return row === null ? [] : [row];
};

const deleteRowsImmediately = async (rows: TModel[]): Promise<void> => {
	if (rows.length === 0) {
		return;
	}

	const keys = rows.map((item) => props.getKey(item));
	emit("delete", {
		rows,
		keys,
	});

	if (!props.autoDelete || !props.api.delete) {
		return;
	}

	deleteRunning.value = true;
	try {
		for (const key of keys) {
			await props.api.delete(key);
		}

		grid.clearMarkedRows();
		await load();
	} finally {
		deleteRunning.value = false;
	}
};

const deleteRows = async (row: TModel | null): Promise<void> => {
	const rows = getCommandTargetRows(row);
	if (rows.length === 0) {
		return;
	}

	if (props.autoDelete && props.api.delete && props.confirmDelete) {
		deletePendingRows.value = rows;
		deleteConfirmVisible.value = true;
		return;
	}

	await deleteRowsImmediately(rows);
};

const cancelDelete = (): void => {
	if (deleteRunning.value) {
		return;
	}

	deleteConfirmVisible.value = false;
	deletePendingRows.value = [];
};

const confirmDeleteRows = async (): Promise<void> => {
	const rows = [...deletePendingRows.value] as TModel[];
	await deleteRowsImmediately(rows);
	deleteConfirmVisible.value = false;
	deletePendingRows.value = [];
};

const getCommandContext = (
	name: string,
	row: TModel | null,
	createContext?: GridCreateContext,
): GridCommandContext<TModel, TKey> => {
	const rows = getCommandTargetRows(row);
	const keys = rows.map((item) => props.getKey(item));

	return {
		name,
		createContext,
		row,
		rows,
		keys,
		selectedRow: grid.selectedRow.value,
		selectedCell: grid.selectedCell.value,
		selectedColumn: grid.selectedColumn.value,
		markedRows: [...grid.markedRows.value],
		clearMarkedRows: grid.clearMarkedRows,
		reload: load,
	};
};

const findVisibleCommand = (name: string): GridCommandRuntime<TModel, TKey> | null => {
	return visibleCommands.value.find((item) => item.name === name) ?? null;
};

const executeCommand = async (
	name: string,
	command?: GridCommandRuntime<TModel, TKey>,
): Promise<void> => {
	const row = grid.selectedRow.value;
	const runtimeCommand = command ?? findVisibleCommand(name);

	if (runtimeCommand?.disabled) {
		return;
	}

	const createContext = hierarchy.enabled.value && (name === "create" || name === "createGroup")
		? hierarchy.createContext(name === "createGroup" ? "group" : "item")
		: undefined;
	const context = getCommandContext(name, row, createContext);

	emit("command", {
		name,
		createContext,
		row,
		rows: context.rows,
		keys: context.keys,
	});

	if (runtimeCommand?.handler) {
		await runtimeCommand.handler(context);

		if (!runtimeCommand.runDefault) {
			return;
		}
	}

	if (name === "toggleHierarchyView") {
		hierarchy.toggleViewMode();
		grid.setPage(0, grid.rowsPerPage.value);
		grid.selectRow(null);
		await load();
		return;
	}

	if (name === "search") {
		openSearchDialog();
		return;
	}

	if (name === "refresh") {
		emit("refresh");
		await load();
		return;
	}

	if (name === "delete") {
		await deleteRows(row);
		return;
	}

	if (name === "edit" && startInlineEdit(row)) {
		return;
	}

	if (
		(name === "create" || name === "createGroup")
		&& await startInlineCreate(createContext)
	) {
		return;
	}

	if (await openRoute(name, row, createContext)) {
		return;
	}

	if (name === "create" || name === "createGroup") {
		emit("create", createContext);
	} else if (name === "edit" && row !== null) {
		emit("edit", row);
	} else if (name === "copy" && row !== null) {
		emit("copy", row);
	}
};

const closeReferenceSelectionWindow = (): void => {
	if (typeof window !== "undefined") {
		window.close();
	}
};

const returnReferenceSelection = (row: TModel): void => {
	const token = referenceSelectionToken.value;
	if (token === null || typeof window === "undefined") {
		return;
	}

	const message = makeReferenceSelectionMessage(token, row);

	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel(referenceSelectionChannelName(token));
		channel.postMessage(message);
		channel.close();
	}

	if (window.opener !== null && !window.opener.closed) {
		window.opener.postMessage(message, window.location.origin);
	}

	setTimeout(closeReferenceSelectionWindow, 0);
};

const activateRow = async (row: TModel | null): Promise<void> => {
	if (row === null || inlineEditing.value) {
		return;
	}

	grid.selectRow(row);
	emit("selectionChange", row);

	if (hierarchy.enterGroup(row)) {
		grid.setPage(0, grid.rowsPerPage.value);
		grid.selectRow(null);
		await load();
		return;
	}

	if (referenceSelectionMode.value) {
		if (hierarchy.enabled.value && !hierarchy.isSelectable(row)) {
			return;
		}

		returnReferenceSelection(row);
		return;
	}

	await executeCommand("edit");
};

const selectCurrentReferenceRow = (): void => {
	const row = grid.selectedRow.value;
	if (
		row !== null
		&& (!hierarchy.enabled.value || hierarchy.isSelectable(row))
	) {
		returnReferenceSelection(row);
	}
};

const isSearchShortcut = (event: KeyboardEvent): boolean => {
	return (event.ctrlKey || event.metaKey)
		&& !event.altKey
		&& !event.shiftKey
		&& event.key.toLowerCase() === "f";
};

const isSearchTypingCharacter = (event: KeyboardEvent): boolean => {
	return !event.ctrlKey
		&& !event.metaKey
		&& !event.altKey
		&& !event.isComposing
		&& /^[\p{L}\p{N}]$/u.test(event.key);
};

const onRootKeydown = async (event: KeyboardEvent): Promise<void> => {
	// Keyboard events from inputs and other editor controls bubble to the grid
	// root. They belong to the control, not to collection-level shortcuts.
	if (isInteractiveGridTarget(event.target)) {
		return;
	}

	// While an inline row is being edited, suspend grid keyboard routing even
	// if focus temporarily returns to the grid root. This prevents typed text
	// from opening the search dialog and avoids command/arrow shortcuts acting
	// on the collection behind the active editor.
	if (inlineEditing.value) {
		return;
	}

	if (isSearchShortcut(event)) {
		event.preventDefault();
		openSearchDialog();
		return;
	}

	if (!searchDialogVisible.value && isSearchTypingCharacter(event)) {
		event.preventDefault();
		openSearchDialog(null, event.key);
		return;
	}

	if (
		event.key === "Enter"
		&& !event.ctrlKey
		&& !event.metaKey
		&& !event.altKey
		&& !event.shiftKey
	) {
		event.preventDefault();
		await activateRow(grid.selectedRow.value);
		return;
	}

	const commandName = findCommandByShortcut(visibleCommands.value, event);
	if (commandName !== null) {
		event.preventDefault();
		await executeCommand(commandName);
		return;
	}

	if (grid.handleGridArrowKey(event)) {
		emit("selectionChange", grid.selectedRow.value);
		emit("cellChange", grid.selectedCell.value);
	}
};

const onRowDoubleClick = async (event: {
	data: TModel;
}): Promise<void> => {
	await activateRow(event.data);
};

const onRowEditInit = (event: {
	data: TModel;
}): void => {
	originalRows.set(event.data, cloneGridRow(event.data));
};

const onRowEditSave = async (event: {
	data: TModel;
	newData: TModel;
}): Promise<void> => {
	if (inlineCreateRow.value === event.data) {
		if (!props.api.create) {
			return;
		}

		const baseModel = props.createModel
			? props.createModel(event.newData)
			: makeCreateModel<TModel, TNew>(event.newData, props.columns);
		const model = inlineCreateContext.value?.initialValues
			? {
				...(baseModel as object),
				...inlineCreateContext.value.initialValues,
			} as TNew
			: baseModel;

		try {
			const key = await props.api.create(model);
			emit("rowCreate", {
				key,
				model,
				row: event.newData,
			});

			inlineCreateRow.value = null;
			inlineCreateContext.value = undefined;
			inlineCreatePreviousSelection.value = null;
			editingRows.value = [];
			originalRows.delete(event.data);
			await load();
		} catch (err: unknown) {
			Object.assign(event.data, event.newData);
			grid.error.value = errorText(err);
			editingRows.value = [event.data];
		}
		return;
	}

	if (!props.api.update) {
		return;
	}

	const original = originalRows.get(event.data) ?? event.data;
	const model = makeChangedModel<TModel, TUpd>(
		original,
		event.newData,
		props.columns,
	);

	if (Object.keys(model).length === 0) {
		return;
	}

	const key = props.getKey(original);
	await props.api.update(key, model);
	emit("rowUpdate", {
		key,
		model,
		row: event.newData,
	});
	await load();
};

const onRowEditCancel = (event: {
	data: TModel;
}): void => {
	if (inlineCreateRow.value === event.data) {
		discardInlineCreate();
		return;
	}

	originalRows.delete(event.data);
};

const columnFooter = (column: GridColumn<TModel>): string => {
	if (!column.footer) {
		return "";
	}

	if (column.footer.label) {
		return column.footer.label;
	}

	if (column.footer.aggKey) {
		const value = grid.agg.value[column.footer.aggKey];
		return value === null || value === undefined ? "" : String(value);
	}

	if (column.footer.calc) {
		const value = column.footer.calc(grid.rows.value, grid.agg.value);
		return value === null || value === undefined ? "" : String(value);
	}

	return "";
};

const focus = async (): Promise<void> => {
	await nextTick();
	focusGridRootWithoutScroll(null);
};

defineExpose<CollectionGridExpose>({
	load,
	focus,
	clearMarkedRows: grid.clearMarkedRows,
	getMarkedRows: () => [...grid.markedRows.value] as object[],
	getCurrentCell: () => grid.selectedCell.value as GridCellPosition<any> | null,
	getCurrentColumn: () => grid.selectedColumn.value as GridColumn<any> | null,
	clearSearch,
});
</script>

<template>
	<div
		ref="rootEl"
		:class="[
			'outline-none',
			hierarchy.enabled.value
				? `crud-grid-hierarchy-${hierarchy.viewMode.value}`
				: '',
		]"
		tabindex="0"
		@keydown="onRootKeydown"
		@pointerdown.capture="onGridRootPointerDown"
		@pointercancel.capture="clearPointerScrollPosition"
		@mousedown.capture="onGridRootMouseDown"
		@click="clearPointerScrollPosition"
		@contextmenu.capture="onGridRootContextMenu"
	>
		<GridCommandPanel
			v-if="props.showCommandPanel"
			:commands="visibleCommands"
			:showShortcuts="props.showCommandShortcuts"
			@command="executeCommand"
		/>

		<CollectionBreadcrumbs
			v-if="hierarchy.enabled.value && hierarchy.viewMode.value === 'hierarchy'"
			:rootLabel="hierarchyRootLabel"
			:groupIcon="hierarchy.openGroupIcon.value"
			:path="hierarchy.path.value"
			:disabled="inlineEditing"
			@navigate="navigateHierarchyBreadcrumb"
		/>

		<GridSearchPanel
			:criteria="grid.searchCriteria.value"
			@open="openSearchCriterion"
			@remove="removeSearchCriterion"
		/>

		<div
			v-if="referenceSelectionMode"
			class="crud-grid-selection-mode"
		>
			<div class="crud-grid-selection-mode-text">
				<strong>{{ t("Grid.selectionMode.title") }}</strong>
				<span>{{ t("Grid.selectionMode.hint") }}</span>
			</div>
			<div class="crud-grid-selection-mode-actions">
				<Button
					:label="t('Grid.selectionMode.select')"
					icon="pi pi-check"
					:disabled="!canSelectCurrentReferenceRow"
					@click="selectCurrentReferenceRow"
				/>
				<Button
					:label="t('Grid.selectionMode.cancel')"
					icon="pi pi-times"
					severity="secondary"
					outlined
					@click="closeReferenceSelectionWindow"
				/>
			</div>
		</div>

		<div
			v-if="grid.error.value"
			class="crud-grid-error"
		>
			{{ grid.error.value }}
		</div>

		<GridSearchDialog
			v-model:visible="searchDialogVisible"
			:columns="searchableColumns"
			:criterion="editingSearchCriterion"
			:initialField="searchInitialField"
			:initialValue="searchInitialValue"
			@apply="applySearch"
		/>

		<Dialog
			v-model:visible="deleteConfirmVisible"
			:header="t('Grid.deleteConfirmTitle')"
			:style="{ width: '28rem' }"
			modal
		>
			<p class="crud-grid-confirm-message">
				{{ t("Grid.deleteConfirm", { count: deletePendingRows.length }) }}
			</p>

			<template #footer>
				<div class="crud-grid-confirm-actions">
					<Button
						:label="t('Grid.commands.cancel')"
						:disabled="deleteRunning"
						severity="secondary"
						outlined
						@click="cancelDelete"
					/>
					<Button
						:label="t('Grid.commands.delete')"
						:loading="deleteRunning"
						icon="pi pi-trash"
						severity="danger"
						@click="confirmDeleteRows"
					/>
				</div>
			</template>
		</Dialog>

		<Teleport to="body">
			<div
				v-if="contextMenuState.visible"
				class="crud-grid-context-menu"
				:style="contextMenuStyle"
				role="menu"
				@click.stop
				@mousedown.stop
				@mouseup.stop
				@contextmenu.prevent.stop
			>
				<div
					v-if="activeContextMenuItems.length === 0"
					class="crud-grid-context-menu-empty"
				>
					No context commands
				</div>

				<button
					v-for="(item, index) in activeContextMenuItems"
					:key="`${item.label}-${index}`"
					type="button"
					class="crud-grid-context-menu-item"
					:class="{ 'crud-grid-context-menu-item-disabled': item.disabled }"
					:disabled="item.disabled"
					role="menuitem"
					@click="runContextMenuItem(item)"
				>
					<i
						v-if="item.icon"
						:class="item.icon"
					/>
					<span>{{ item.label }}</span>
				</button>
			</div>
		</Teleport>

		<DataTable
			v-model:editingRows="editingRows"
			:value="grid.rows.value"
			:dataKey="props.dataKey"
			:loading="grid.loading.value"
			:lazy="true"
			:paginator="true"
			:first="grid.first.value"
			:rows="grid.rowsPerPage.value"
			:totalRecords="grid.totalRecords.value"
			:rowsPerPageOptions="props.rowsPerPageOptions"
			:paginatorTemplate="paginatorTemplate"
			currentPageReportTemplate="{first} - {last} / {totalRecords}"
			:sortField="grid.singleSortField.value"
			:sortOrder="grid.singleSortOrder.value"
			:rowClass="resolveRowClass"
			:editMode="props.editMode === 'inline' ? 'row' : undefined"
			:pt="pt"
			showGridlines
			size="small"
			tableStyle="min-width: 60rem"
			@page="pageChanged"
			@sort="sortChanged"
			@row-click="onRowClick"
			@row-dblclick="onRowDoubleClick"
			@row-edit-init="onRowEditInit"
			@row-edit-save="onRowEditSave"
			@row-edit-cancel="onRowEditCancel"
		>
			<template #empty>
				{{ t("Grid.empty") }}
			</template>

			<Column
				v-if="hierarchy.enabled.value"
				headerStyle="width: 2.75rem"
				bodyStyle="width: 2.75rem; text-align: center"
			>
				<template #body="{ data, index }">
					<div
						:data-grid-row-index="index"
						:class="[
							'crud-grid-hierarchy-icon',
							!inlineEditing && hierarchy.viewMode.value === 'hierarchy' && hierarchy.isGroup(data)
								? 'crud-grid-hierarchy-icon--navigable'
								: '',
						]"
						@click="onHierarchyIconClick($event, data)"
					>
						<slot
							name="hierarchy-icon"
							:data="data"
							:isGroup="hierarchy.isGroup(data)"
							:icon="hierarchy.iconForRow(data)"
							:viewMode="hierarchy.viewMode.value"
						>
							<i :class="hierarchy.iconForRow(data)" />
						</slot>
					</div>
				</template>
			</Column>

			<Column
				v-for="(column, columnIndex) in props.columns"
				:key="column.field"
				:field="column.field"
				:sortField="column.sortField ?? column.field"
				:header="column.header ?? t(column.headerKey)"
				:sortable="column.sortable"
				:style="column.style ?? (column.width ? { width: column.width } : undefined)"
				:pt="resolveCellPassThrough(column, columnIndex)"
			>
				<template #body="{ data, index }">
					<div
						:data-grid-row-index="index"
						:data-grid-column-index="columnIndex"
						:class="[
							'crud-grid-cell-content',
							column.align === 'right' ? 'crud-grid-cell-content--right' : '',
							column.align === 'center' ? 'crud-grid-cell-content--center' : '',
							!effectiveRowSelection && isSelectedCell(index, columnIndex) ? 'crud-grid-cell-current-marker' : '',
						]"
						@click="onCellClick(data, index, columnIndex)"
					>
						<slot
							:name="`body-${column.field}`"
							:data="data"
							:field="column.field"
							:value="data[column.field]"
						>
							<ReferenceKeyLabel
								v-if="column.dataType === 'reference' && column.reference"
								:modelValue="data[column.field]"
								:projectedValue="column.referenceField ? data[column.referenceField] : undefined"
								:reference="column.reference"
							/>
							<template v-else>
								{{ formatGridValue(data, column) }}
							</template>
						</slot>
					</div>
				</template>

				<template
					v-if="props.editMode === 'inline' && column.editable"
					#editor="{ data, field }"
				>
					<slot
						:name="`editor-${column.field}`"
						:data="getReactiveGridEditRow(data)"
						:field="field"
						:value="getReactiveGridEditRow(data)[field]"
						:updateValue="(value:any) => applyGridInlineValue(data, column, value)"
					>
						<ReferenceKeyInput
							v-if="column.dataType === 'reference' && column.reference"
							v-bind="column.editorProps"
							:modelValue="getReactiveGridEditRow(data)[field]"
							:projectedValue="column.referenceField ? getReactiveGridEditRow(data)[column.referenceField] : undefined"
							:reference="column.reference"
							class="crud-grid-editor-control"
							@update:modelValue="applyGridInlineValue(data, column, $event)"
						/>
						<Checkbox
							v-else-if="column.dataType === 'boolean'"
							v-bind="column.editorProps"
							:modelValue="getReactiveGridEditRow(data)[field]"
							binary
							@update:modelValue="applyGridInlineValue(data, column, $event)"
						/>
						<InputNumber
							v-else-if="column.dataType === 'number'"
							v-bind="column.editorProps"
							:modelValue="getReactiveGridEditRow(data)[field]"
							class="crud-grid-editor-control"
							@update:modelValue="applyGridInlineValue(data, column, $event)"
						/>
						<InputText
							v-else
							v-bind="column.editorProps"
							:modelValue="getReactiveGridEditRow(data)[field]"
							class="crud-grid-editor-control"
							@update:modelValue="applyGridInlineValue(data, column, $event)"
						/>
					</slot>
				</template>

				<template #footer>
					<slot
						:name="`footer-${column.field}`"
						:rows="grid.rows.value"
						:agg="grid.agg.value"
						:column="column"
					>
						{{ columnFooter(column) }}
					</slot>
				</template>
			</Column>

			<Column
				v-if="props.editMode === 'inline' && !referenceSelectionMode"
				:rowEditor="true"
				headerStyle="width: 7rem"
				bodyStyle="text-align: center"
			>
				<template #header>
					<i class="pi pi-pencil" />
				</template>
			</Column>
		</DataTable>

	</div>
</template>


<style scoped>
.crud-grid-selection-mode {
	align-items: center;
	background: var(--p-blue-50, rgb(239 246 255));
	border: 1px solid var(--p-blue-200, rgb(191 219 254));
	border-radius: var(--p-border-radius-md, 0.375rem);
	display: flex;
	gap: 1rem;
	justify-content: space-between;
	margin-bottom: 0.75rem;
	padding: 0.5rem 0.75rem;
}

.crud-grid-selection-mode-text {
	display: flex;
	flex-direction: column;
	font-size: 0.875rem;
	gap: 0.125rem;
}

.crud-grid-selection-mode-actions {
	display: flex;
	flex: 0 0 auto;
	gap: 0.5rem;
}

:deep(.crud-grid-row-new > td) {
	background: var(--p-green-50, rgb(240 253 244));
}

:deep(.crud-grid-row-selectable) {
	cursor: pointer;
}

:deep(.crud-grid-row-not-selectable) {
	cursor: default;
}

:deep(.crud-grid-row-group > td) {
	font-size: var(--crud-grid-group-font-size, 1.05em);
	font-weight: var(--crud-grid-group-font-weight, 600);
}

.crud-grid-hierarchy-icon {
	align-items: center;
	display: flex;
	justify-content: center;
	min-height: 1.75rem;
	padding: 0.25rem;
}

.crud-grid-hierarchy-icon--navigable {
	cursor: pointer;
}

.crud-grid-error {
	background: var(--p-red-50, rgb(254 242 242));
	border: 1px solid var(--p-red-200, rgb(254 202 202));
	border-radius: var(--p-border-radius-md, 0.375rem);
	color: var(--p-red-700, rgb(185 28 28));
	font-size: 0.875rem;
	margin-bottom: 0.75rem;
	padding: 0.5rem 0.75rem;
}

.crud-grid-confirm-message {
	color: var(--p-text-muted-color, rgb(55 65 81));
	font-size: 0.875rem;
	line-height: 1.5rem;
	margin: 0;
}

.crud-grid-confirm-actions {
	display: flex;
	gap: 0.5rem;
	justify-content: flex-end;
}

.crud-grid-cell-content {
	display: block;
	min-height: 1.75rem;
	padding: 0.25rem 0.5rem;
	width: 100%;
}

.crud-grid-cell-content--right {
	text-align: right;
}

.crud-grid-cell-content--center {
	text-align: center;
}

.crud-grid-editor-control {
	width: 100%;
}

:deep(.crud-grid-row-marked > td) {
	background-color: rgb(254 249 195) !important;
}

:deep(.crud-grid-row-current > td) {
	background-color: rgb(239 246 255) !important;
}

:deep(.crud-grid-row-current.crud-grid-row-marked > td) {
	background-color: rgb(254 240 138) !important;
}

:deep(.p-datatable-tbody > tr > td.crud-grid-cell-current),
:deep(.p-datatable-tbody > tr > td:has(> .crud-grid-cell-current-marker)) {
	position: relative;
	z-index: 1;
	box-shadow: inset 0 0 0 2px rgb(59 130 246);
}

.crud-grid-context-menu {
	position: fixed !important;
	z-index: 2147483647 !important;
	min-width: 12rem;
	max-width: 24rem;
	overflow: hidden;
	border: 1px solid rgb(229 231 235);
	border-radius: 0.5rem;
	background: white;
	color: rgb(17 24 39);
	box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
	padding: 0.25rem;
	pointer-events: auto;
}

.crud-grid-context-menu-empty {
	padding: 0.5rem 0.75rem;
	font-size: 0.875rem;
	color: rgb(107 114 128);
	white-space: nowrap;
}

.crud-grid-context-menu-item {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 0.5rem;
	border: 0;
	border-radius: 0.375rem;
	background: transparent;
	padding: 0.5rem 0.75rem;
	text-align: left;
	font-size: 0.875rem;
	cursor: pointer;
}

.crud-grid-context-menu-item:hover:not(:disabled) {
	background: rgb(243 244 246);
}

.crud-grid-context-menu-item-disabled {
	opacity: 0.5;
	cursor: not-allowed;
}


:deep(.p-datatable-tbody > tr.crud-grid-row-current) {
	outline: none !important;
}

:deep(.p-datatable-tbody > tr.crud-grid-row-current > td) {
	border-color: rgb(191 219 254) !important;
}

:deep(.p-datatable-tbody > tr.crud-grid-row-current > td:first-child) {
	position: relative;
}

:deep(.p-datatable-tbody > tr.crud-grid-row-current > td:first-child::before) {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	width: 3px;
	background: rgb(59 130 246);
	content: "";
}

</style>
