import { shallowRef } from "vue";

import type {
	FormMutationField,
	FormMutationFieldConfig,
	ReferenceLike,
	UseFormMutationOptions,
} from "../../types/formMutation";
import { isReferenceValue } from "../../utils/reference";

const defaultClone = <TValue>(value: TValue): TValue => {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as TValue;
};

const normalizeComparable = (value: unknown): unknown => {
	if (value instanceof Date) {
		return value.toISOString();
	}

	if (Array.isArray(value)) {
		return value.map(normalizeComparable);
	}

	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, normalizeComparable(item)]),
		);
	}

	return value;
};

const stableStringify = (value: unknown): string => {
	return JSON.stringify(normalizeComparable(value)) ?? "undefined";
};

const valuesEqual = (
	left: unknown,
	right: unknown,
): boolean => {
	if (left === right) {
		return true;
	}

	return stableStringify(left) === stableStringify(right);
};

const normalizeField = <
	TDetail extends object,
	TSubmit extends object,
>(
	field: FormMutationFieldConfig<TDetail, TSubmit>,
): FormMutationField<TDetail, TSubmit> => {
	if (typeof field === "string") {
		return {
			detailField: field,
			submitField: field as unknown as keyof TSubmit & string,
			kind: "plain",
			omitUndefined: true,
		};
	}

	return {
		kind: "plain",
		omitUndefined: true,
		...field,
	};
};

const referenceSubmitValue = (
	value: ReferenceLike,
	field: FormMutationField<object, object>,
): unknown => {
	if (!value || !isReferenceValue(value)) {
		return null;
	}

	const mode = field.reference?.mode ?? "keys";

	if (mode === "value") {
		return value;
	}

	if (mode === "key") {
		const keyField = field.reference?.keyField;
		if (!keyField) {
			throw new Error(`Reference field ${field.detailField} uses mode=key without keyField`);
		}

		return value.keys?.[keyField] ?? null;
	}

	return value.keys ?? null;
};

const readDetailValue = <TDetail extends object>(
	detail: TDetail,
	field: keyof TDetail & string,
): unknown => {
	return (detail as Record<string, unknown>)[field];
};

const submitValue = <
	TDetail extends object,
	TSubmit extends object,
>(
	detail: TDetail,
	field: FormMutationField<TDetail, TSubmit>,
): unknown => {
	const value = readDetailValue(detail, field.detailField);

	if (field.value) {
		return field.value(value, detail);
	}

	if (field.kind === "reference") {
		return referenceSubmitValue(
			value as ReferenceLike,
			field as FormMutationField<object, object>,
		);
	}

	return value;
};

const shouldOmit = <
	TDetail extends object,
	TSubmit extends object,
>(
	value: unknown,
	field: FormMutationField<TDetail, TSubmit>,
): boolean => {
	if (value === undefined && field.omitUndefined !== false) {
		return true;
	}

	if (value === null && field.omitNull === true) {
		return true;
	}

	return false;
};

const assignSubmitValue = <TSubmit extends object>(
	model: Partial<TSubmit>,
	field: FormMutationField<object, TSubmit>,
	value: unknown,
): void => {
	const submitField = field.submitField ?? field.detailField;
	model[submitField as keyof TSubmit] = value as TSubmit[keyof TSubmit];
};

export const useFormMutation = <
	TDetail extends object,
	TCreate extends object,
	TUpdate extends object,
>(
	options: UseFormMutationOptions<TDetail, TCreate, TUpdate>,
) => {
	const clone = options.clone ?? defaultClone;
	const initialModel = shallowRef<TDetail | null>(null);
	const fields = options.fields.map((field) => {
		return normalizeField<TDetail, TCreate | TUpdate>(field);
	});

	const setInitialModel = (model: TDetail | null | undefined): void => {
		initialModel.value = model ? clone(model) : null;
	};

	const buildCreateModel = (current: TDetail): TCreate => {
		const result: Partial<TCreate> = {};

		fields.forEach((field) => {
			if (field.create === false) {
				return;
			}

			const value = submitValue(current, field);
			if (shouldOmit(value, field)) {
				return;
			}

			assignSubmitValue(
				result,
				field as FormMutationField<object, TCreate>,
				value,
			);
		});

		return result as TCreate;
	};

	const buildUpdateModel = (
		current: TDetail,
		initial: TDetail | null = initialModel.value,
	): TUpdate => {
		const result: Partial<TUpdate> = {};

		fields.forEach((field) => {
			if (field.update === false) {
				return;
			}

			const currentValue = submitValue(current, field);
			if (shouldOmit(currentValue, field)) {
				return;
			}

			const initialValue = initial ? submitValue(initial, field) : undefined;
			const equal = field.compare
				? field.compare(initialValue, currentValue)
				: valuesEqual(initialValue, currentValue);

			if (equal) {
				return;
			}

			assignSubmitValue(
				result,
				field as FormMutationField<object, TUpdate>,
				currentValue,
			);
		});

		return result as TUpdate;
	};

	const hasChanges = (
		current: TDetail,
		initial: TDetail | null = initialModel.value,
	): boolean => {
		return Object.keys(buildUpdateModel(current, initial)).length > 0;
	};

	return {
		initialModel,
		setInitialModel,
		buildCreateModel,
		buildUpdateModel,
		hasChanges,
	};
};
