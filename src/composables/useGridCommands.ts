import type {
	GridCommand,
	GridCommandListMode,
	GridCommandName,
	GridCommandRuntime,
} from "../components/crudGrid/types";

export const defaultGridCommands = <
	TModel extends object,
	TKey = unknown,
>(): GridCommand<TModel, TKey>[] => {
	return [
		{
			name: "create",
			labelKey: "Grid.commands.create",
			icon: "pi pi-plus",
			shortcut: "Insert",
		},
		{
			name: "edit",
			labelKey: "Grid.commands.edit",
			icon: "pi pi-pencil",
			shortcut: "F4",
			enabled: (row: TModel | null): boolean => row !== null,
		},
		{
			name: "copy",
			labelKey: "Grid.commands.copy",
			icon: "pi pi-copy",
			shortcut: "F9",
			enabled: (row: TModel | null): boolean => row !== null,
		},
		{
			name: "delete",
			labelKey: "Grid.commands.delete",
			icon: "pi pi-trash",
			shortcut: "Delete",
			severity: "danger",
			enabled: (row: TModel | null): boolean => row !== null,
		},
		{
			name: "search",
			labelKey: "Grid.commands.search",
			icon: "pi pi-search",
			shortcut: "Ctrl+F",
		},
		{
			name: "refresh",
			labelKey: "Grid.commands.refresh",
			icon: "pi pi-refresh",
			shortcut: "F5",
		},
	];
};

const boolValue = <TModel extends object>(
	value: boolean | ((row: TModel | null) => boolean) | undefined,
	row: TModel | null,
	defaultValue: boolean,
): boolean => {
	if (value === undefined) {
		return defaultValue;
	}

	if (typeof value === "function") {
		return value(row);
	}

	return value;
};

const normalizeShortcut = (shortcut: string): string => {
	return shortcut
		.trim()
		.toLowerCase()
		.replaceAll(" ", "");
};

export const shortcutMatchesEvent = (
	shortcut: string | undefined,
	event: KeyboardEvent,
): boolean => {
	if (!shortcut) {
		return false;
	}

	const normalized = normalizeShortcut(shortcut);
	const parts = normalized.split("+");
	const key = parts[parts.length - 1];

	const requiresCtrl = parts.includes("ctrl") || parts.includes("control");
	const requiresAlt = parts.includes("alt");
	const requiresShift = parts.includes("shift");

	if (requiresCtrl !== event.ctrlKey) {
		return false;
	}

	if (requiresAlt !== event.altKey) {
		return false;
	}

	if (requiresShift !== event.shiftKey) {
		return false;
	}

	return event.key.toLowerCase() === key;
};

const mergeCommandWithDefault = <
	TModel extends object,
	TKey,
>(
	command: GridCommand<TModel, TKey>,
	defaults: GridCommand<TModel, TKey>[],
): GridCommand<TModel, TKey> => {
	const defaultCommand = defaults.find((item) => item.name === command.name);

	return {
		...(defaultCommand ?? {}),
		...command,
	};
};

const buildCommandList = <
	TModel extends object,
	TKey,
>(
	commands: GridCommand<TModel, TKey>[] | undefined,
	mode: GridCommandListMode,
): GridCommand<TModel, TKey>[] => {
	const defaults = defaultGridCommands<TModel, TKey>();

	if (mode === "default" || !commands || commands.length === 0) {
		return defaults;
	}

	if (mode === "replace") {
		return commands.map((command) => {
			return mergeCommandWithDefault(command, defaults);
		});
	}

	const customByName = new Map<GridCommandName, GridCommand<TModel, TKey>>();
	commands.forEach((command) => {
		customByName.set(command.name, command);
	});

	const mergedDefaults = defaults.map((defaultCommand) => {
		const customCommand = customByName.get(defaultCommand.name);
		if (!customCommand) {
			return defaultCommand;
		}

		customByName.delete(defaultCommand.name);
		return {
			...defaultCommand,
			...customCommand,
		};
	});

	return [
		...mergedDefaults,
		...Array.from(customByName.values()),
	];
};

export const resolveGridCommands = <
	TModel extends object,
	TKey = unknown,
>(
	commands: GridCommand<TModel, TKey>[] | undefined,
	row: TModel | null,
	translate: (key: string) => string,
	mode: GridCommandListMode = "replace",
): GridCommandRuntime<TModel, TKey>[] => {
	return buildCommandList(commands, mode)
		.filter((command) => boolValue(command.visible, row, true))
		.map((command) => {
			const label = command.label
				?? (command.labelKey ? translate(command.labelKey) : command.name);

			return {
				...command,
				label,
				disabled: !boolValue(command.enabled, row, true),
			};
		});
};

export const findCommandByShortcut = <
	TModel extends object,
	TKey = unknown,
>(
	commands: GridCommandRuntime<TModel, TKey>[],
	event: KeyboardEvent,
): GridCommandName | null => {
	const command = commands.find((item) => {
		return !item.disabled && shortcutMatchesEvent(item.shortcut, event);
	});

	return command?.name ?? null;
};
