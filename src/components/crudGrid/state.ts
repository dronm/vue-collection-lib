import type { SavedGridState } from "./types";

export const COLLECTION_GRID_STATE_VERSION = 1;

const parseGridState = (raw: string): SavedGridState | null => {
	try {
		const value = JSON.parse(raw) as Partial<SavedGridState>;

		if (value.version !== COLLECTION_GRID_STATE_VERSION) {
			return null;
		}

		return value as SavedGridState;
	} catch {
		return null;
	}
};

export const readCollectionGridState = (
	stateKey: string | undefined,
): SavedGridState | null => {
	if (!stateKey) {
		return null;
	}

	const raw = sessionStorage.getItem(stateKey);
	if (!raw) {
		return null;
	}

	return parseGridState(raw);
};

export const writeCollectionGridState = (
	stateKey: string | undefined,
	state: Omit<SavedGridState, "version">,
): void => {
	if (!stateKey) {
		return;
	}

	const versionedState: SavedGridState = {
		version: COLLECTION_GRID_STATE_VERSION,
		...state,
	};

	sessionStorage.setItem(stateKey, JSON.stringify(versionedState));
};
