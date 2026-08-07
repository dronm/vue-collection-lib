import {
	collectionFormDirtyGuardAllowNextNavigationEvent,
	collectionFormDirtyGuardMarkCleanEvent,
	collectionFormDirtyGuardMarkDirtyEvent,
} from "./events";

const dispatchCollectionDirtyGuardEvent = (
	name: string,
): void => {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(new CustomEvent(name));
};

export const markCollectionFormClean = (): void => {
	dispatchCollectionDirtyGuardEvent(collectionFormDirtyGuardMarkCleanEvent);
};

export const markCollectionFormDirty = (): void => {
	dispatchCollectionDirtyGuardEvent(collectionFormDirtyGuardMarkDirtyEvent);
};

export const allowNextCollectionDirtyGuardNavigation = (): void => {
	dispatchCollectionDirtyGuardEvent(collectionFormDirtyGuardAllowNextNavigationEvent);
};

export const runWithoutCollectionDirtyGuard = async <TResult>(
	callback: () => TResult | Promise<TResult>,
): Promise<TResult> => {
	allowNextCollectionDirtyGuardNavigation();

	try {
		return await callback();
	} catch (err: unknown) {
		markCollectionFormDirty();
		throw err;
	}
};
