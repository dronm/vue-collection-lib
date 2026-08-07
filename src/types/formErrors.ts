export type FormFieldName = string;

export type FormFieldErrors = Record<FormFieldName, string[]>;

export interface FormErrorSource {
	fieldErrors?: FormFieldErrors;
	formErrors?: string[];
}

export interface FormErrorsView {
	fieldErrors: FormFieldErrors;
	formErrors: string[];
	has: (field: FormFieldName) => boolean;
	first: (field: FormFieldName) => string;
	all: (field: FormFieldName) => string[];
}

export interface FormErrorsController extends FormErrorsView {
	clear: () => void;
	clearField: (field: FormFieldName) => void;
	setField: (
		field: FormFieldName,
		messages: string | string[],
	) => void;
	addField: (
		field: FormFieldName,
		message: string,
	) => void;
	setForm: (messages: string | string[]) => void;
	addForm: (message: string) => void;
	setFromError: (err: unknown) => void;
	fieldProps: (field: FormFieldName) => {
		invalid: boolean;
		"aria-invalid": "true" | undefined;
	};
}
