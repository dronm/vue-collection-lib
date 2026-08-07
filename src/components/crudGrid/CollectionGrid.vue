<script setup lang="ts" generic="TModel extends object, TKey, TNew, TUpd extends object, TDetailModel = TModel">
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, type RouteLocationRaw } from "vue-router";

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

import { useWSManager } from "../../api/wsProvider";
import { SortDirect, type CollectionSorter } from "../../types/collection";
import { useCollectionGrid } from "../../composables/useCollectionGrid";
import {
	findCommandByShortcut,
	resolveGridCommands,
} from "../../composables/useGridCommands";
import GridCommandPanel from "./GridCommandPanel.vue";
import GridSearchDialog from "./GridSearchDialog.vue";
import GridSearchPanel from "./GridSearchPanel.vue";
import {
	focusGridElementWithoutScroll,
	readGridScrollPosition,
	type GridScrollPosition,
} from "./focusUtils";
import {
	cloneGridRow,
	formatGridValue,
	makeChangedModel,
} from "./gridUtils";
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
	GridDeleteEvent,
	GridEditMode,
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
	rowSelection?: boolean;
	showCommandPanel?: boolean;
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
	create: [];
	edit: [row: TModel];
	copy: [row: TModel];
	delete: [event: GridDeleteEvent<TModel, TKey>];
	refresh: [];
	selectionChange: [row: TModel | null];
	cellChange: [cell: GridCellPosition<TModel> | null];
	rowUpdate: [payload: {
		key: TKey;
		model: TUpd;
		row: TModel;
	}];
}>();

const { t } = useI18n();
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
const editingRows = ref<TModel[]>([]);
const originalRows = new WeakMap<TModel, TModel>();
const rootEl = ref<HTMLElement | null>(null);
const pointerScrollPosition = ref<GridScrollPosition | null>(null);

const columnsRef = computed(() => props.columns);

const grid = useCollectionGrid<TModel, TKey, TNew, TUpd, TDetailModel>({
	api: props.api,
	columns: columnsRef,
	getKey: props.getKey,
	stateKey: props.stateKey,
	pageSize: props.pageSize,
	rowSelection: props.rowSelection,
	defaultSorter: props.defaultSorter,
});

const searchableColumns = computed(() => {
	return buildSearchColumnOptions(props.columns, t);
});

const currentSearchField = computed(() => {
	if (props.rowSelection || grid.selectedCell.value === null) {
		return null;
	}

	const field = grid.selectedCell.value.field;
	return searchableColumns.value.some((column) => column.field === field)
		? field
		: null;
});

const visibleCommands = computed(() => {
	return resolveGridCommands<TModel, TKey>(
		props.commands,
		grid.selectedRow.value,
		t,
		props.commandsMode,
	);
});

const buildContextMenuItems = (row: TModel | null): ContextMenuItem[] => {
	if (!props.showContextMenu) {
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
	];

	if (grid.isRowMarked(row)) {
		classes.push("crud-grid-row-marked");
	}

	if (props.rowSelection && grid.selectedRow.value === row) {
		classes.push("crud-grid-row-current");
	}

	return classes.join(" ");
};

const load = async (): Promise<void> => {
	await grid.load();
};

const crudEventService = computed(() => {
	const serviceName = props.eventService ?? props.api.serviceName;
	const normalized = serviceName?.trim() ?? "";

	return normalized === "" ? null : normalized;
});

let crudSubscriptionId: string | null = null;
let eventRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedWhileConnected = false;

const clearEventRefreshTimer = (): void => {
	if (eventRefreshTimer === null) {
		return;
	}

	clearTimeout(eventRefreshTimer);
	eventRefreshTimer = null;
};

const scheduleEventRefresh = (): void => {
	clearEventRefreshTimer();
	eventRefreshTimer = setTimeout(() => {
		eventRefreshTimer = null;

		if (grid.loading.value) {
			scheduleEventRefresh();
			return;
		}

		void load().catch((error: unknown) => {
			console.error("Failed to refresh collection after CRUD event", error);
		});
	}, props.eventRefreshDelay);
};

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

const GRID_INTERACTIVE_POINTER_SELECTOR = [
	"a[href]",
	"button",
	"input",
	"select",
	"textarea",
	"summary",
	"[contenteditable='true']",
	"[role='button']",
	"[role='checkbox']",
	"[role='combobox']",
	"[role='link']",
	"[role='radio']",
	"[role='switch']",
].join(",");

const isInteractivePointerTarget = (target: EventTarget | null): boolean => {
	return target instanceof Element
		&& target.closest(GRID_INTERACTIVE_POINTER_SELECTOR) !== null;
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
	if (props.rowSelection) {
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
				!props.rowSelection
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

	if (!props.rowSelection && rowIndex !== null && columnIndex !== null) {
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
			&& !isInteractivePointerTarget(event.target)
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
) => {
	const config = name === "create"
		? props.routes?.create
		: name === "copy"
			? props.routes?.copy
			: props.routes?.edit;

	if (!config) {
		return null;
	}

	if (typeof config === "function") {
		const factory = config as (...args: any[]) => unknown;
		if (name === "create") {
			return factory();
		}

		return row ? factory(row) : null;
	}

	return config;
};

const openRoute = async (
	name: string,
	row: TModel | null,
): Promise<boolean> => {
	if (props.editMode !== "page" && props.editMode !== "tab") {
		return false;
	}

	const route = routeForCommand(name, row) as RouteLocationRaw | null;
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

	originalRows.set(row, cloneGridRow(row));
	editingRows.value = [row];
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
): GridCommandContext<TModel, TKey> => {
	const rows = getCommandTargetRows(row);
	const keys = rows.map((item) => props.getKey(item));

	return {
		name,
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

	const context = getCommandContext(name, row);

	emit("command", {
		name,
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

	if (await openRoute(name, row)) {
		return;
	}

	if (name === "create") {
		emit("create");
	} else if (name === "edit" && row !== null) {
		emit("edit", row);
	} else if (name === "copy" && row !== null) {
		emit("copy", row);
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
	grid.selectRow(event.data);
	await executeCommand("edit");
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
		class="outline-none"
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
			@command="executeCommand"
		/>

		<GridSearchPanel
			:criteria="grid.searchCriteria.value"
			@open="openSearchCriterion"
			@remove="removeSearchCriterion"
		/>

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
		>
			<template #empty>
				{{ t("Grid.empty") }}
			</template>

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
							!props.rowSelection && isSelectedCell(index, columnIndex) ? 'crud-grid-cell-current-marker' : '',
						]"
						@click="onCellClick(data, index, columnIndex)"
					>
						<slot
							:name="`body-${column.field}`"
							:data="data"
							:field="column.field"
							:value="data[column.field]"
						>
							{{ formatGridValue(data, column) }}
						</slot>
					</div>
				</template>

				<template
					v-if="props.editMode === 'inline' && column.editable"
					#editor="{ data, field }"
				>
					<slot
						:name="`editor-${column.field}`"
						:data="data"
						:field="field"
						:value="data[field]"
					>
						<Checkbox
							v-if="column.dataType === 'boolean'"
							v-model="data[field]"
							binary
						/>
						<InputNumber
							v-else-if="column.dataType === 'number'"
							v-model="data[field]"
							class="crud-grid-editor-control"
						/>
						<InputText
							v-else
							v-model="data[field]"
							class="crud-grid-editor-control"
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
				v-if="props.editMode === 'inline'"
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
