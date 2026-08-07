import { reactive } from "vue";

import type {
	FormErrorsController,
	FormFieldErrors,
	FormFieldName,
} from "../../types/formErrors";
import { formErrorsFromError } from "../../utils/validation";

const normalizeMessages = (messages: string | string[]): string[] => {
	return Array.isArray(messages) ? messages : [messages];
};

const replaceObject = <TValue extends Record<string, unknown>>(
	target: TValue,
	source: TValue,
): void => {
	Object.keys(target).forEach((key) => {
		delete target[key];
	});

	Object.assign(target, source);
};

export const useFormErrors = (): FormErrorsController => {
	const fieldErrors = reactive<FormFieldErrors>({});
	const formErrors = reactive<string[]>([]);

	const clear = (): void => {
		replaceObject(fieldErrors, {});
		formErrors.splice(0, formErrors.length);
	};

	const clearField = (field: FormFieldName): void => {
		delete fieldErrors[field];
	};

	const setField = (
		field: FormFieldName,
		messages: string | string[],
	): void => {
		fieldErrors[field] = normalizeMessages(messages);
	};

	const addField = (
		field: FormFieldName,
		message: string,
	): void => {
		fieldErrors[field] = [
			...(fieldErrors[field] ?? []),
			message,
		];
	};

	const setForm = (messages: string | string[]): void => {
		formErrors.splice(0, formErrors.length, ...normalizeMessages(messages));
	};

	const addForm = (message: string): void => {
		formErrors.push(message);
	};

	const has = (field: FormFieldName): boolean => {
		return (fieldErrors[field]?.length ?? 0) > 0;
	};

	const first = (field: FormFieldName): string => {
		return fieldErrors[field]?.[0] ?? "";
	};

	const all = (field: FormFieldName): string[] => {
		return fieldErrors[field] ?? [];
	};

	const setFromError = (err: unknown): void => {
		const source = formErrorsFromError(err);

		clear();

		Object.entries(source.fieldErrors ?? {}).forEach(([field, messages]) => {
			setField(field, messages);
		});

		if (source.formErrors?.length) {
			setForm(source.formErrors);
		}
	};

	const fieldProps = (field: FormFieldName): {
		invalid: boolean;
		"aria-invalid": "true" | undefined;
	} => {
		const invalid = has(field);

		return {
			invalid,
			"aria-invalid": invalid ? "true" : undefined,
		};
	};

	return {
		fieldErrors,
		formErrors,
		clear,
		clearField,
		setField,
		addField,
		setForm,
		addForm,
		setFromError,
		has,
		first,
		all,
		fieldProps,
	};
};
