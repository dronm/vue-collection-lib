export type SequentialDeleteResult =
	| {
		succeeded: true;
		deletedCount: number;
	}
	| {
		succeeded: false;
		deletedCount: number;
		error: unknown;
	};

export const deleteRowsSequentially = async <TKey>(
	keys: readonly TKey[],
	deleteRow: (key: TKey) => Promise<unknown>,
): Promise<SequentialDeleteResult> => {
	let deletedCount = 0;
	for (const key of keys) {
		try {
			await deleteRow(key);
			deletedCount += 1;
		} catch (error: unknown) {
			return {
				succeeded: false,
				deletedCount,
				error,
			};
		}
	}

	return {
		succeeded: true,
		deletedCount,
	};
};
