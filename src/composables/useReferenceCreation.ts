import { computed } from "vue";
import { useRoute } from "vue-router";

import {
	cancelReferenceCreation,
	completeReferenceCreation,
	isReferenceCreationQuery,
	REFERENCE_CREATION_QUERY_PARAM,
	referenceCreationTokenFromQuery,
} from "../utils/referenceCreation";
import {
	consumeReferenceCreationDefaults,
	readReferenceCreationDefaults,
} from "../utils/referenceCreationDefaults";

export const useReferenceCreation = () => {
	const route = useRoute();
	const creationMode = computed(() => isReferenceCreationQuery(route.query));
	const creationToken = referenceCreationTokenFromQuery(route.query);
	const sessionQuery = creationToken === null
		? {}
		: { [REFERENCE_CREATION_QUERY_PARAM]: creationToken };
	const defaultValues: Readonly<Record<string, unknown>> | undefined = readReferenceCreationDefaults(route.query);
	let defaultsConsumed = false;

	const consumeDefaultValues = (): Record<string, unknown> | undefined => {
		if (
			defaultsConsumed
			|| creationToken === null
			|| referenceCreationTokenFromQuery(route.query) !== creationToken
		) {
			return undefined;
		}
		const values = consumeReferenceCreationDefaults(route.query);
		defaultsConsumed = true;
		return values;
	};

	/** Apply once to existing model fields, with an optional list of authorized absent fields. */
	const applyDefaultValues = <TModel extends object>(
		model: TModel,
		allowedFields: readonly string[] = [],
	): TModel => {
		const values = consumeDefaultValues();
		if (values !== undefined) {
			for (const [field, value] of Object.entries(values)) {
				if (Object.hasOwn(model, field) || allowedFields.includes(field)) {
					(model as Record<string, unknown>)[field] = value;
				}
			}
		}
		return model;
	};

	const complete = <TKey, TRow extends object>(key: TKey, row: TRow): boolean => {
		if (referenceCreationTokenFromQuery(route.query) !== creationToken) {
			throw new Error("The reference creation session has changed. The saved record cannot be returned from this page.");
		}
		return completeReferenceCreation(key, row, {
			query: sessionQuery,
		});
	};

	const cancel = (): boolean => {
		return cancelReferenceCreation(sessionQuery);
	};

	return {
		creationMode,
		creationToken,
		defaultValues,
		consumeDefaultValues,
		applyDefaultValues,
		complete,
		cancel,
	};
};
