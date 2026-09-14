import * as v from "valibot";

import { apiErrorMessageFromBody } from "../api/Conn";
import type {
	FormErrorSource,
	FormFieldErrors,
} from "../types/formErrors";

interface IssuePathItem {
	key?: unknown;
	value?: unknown;
	origin?: unknown;
}

interface ValidationIssueLike {
	message?: unknown;
	path?: IssuePathItem[];
}

interface ApiErrorLike {
	body?: unknown;
	message?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const stringMessage = (value: unknown): string => {
	if (typeof value === "string" && value.trim() !== "") {
		return value;
	}

	return "invalid value";
};

const issueField = (issue: ValidationIssueLike): string | null => {
	if (!Array.isArray(issue.path) || issue.path.length === 0) {
		return null;
	}

	const parts = issue.path
		.map((item) => {
			if (item.key !== undefined) {
				return String(item.key);
			}

			if (item.value !== undefined) {
				return String(item.value);
			}

			return null;
		})
		.filter((item): item is string => {
			return item !== null && item !== "";
		});

	return parts.length > 0 ? parts.join(".") : null;
};

export const validationIssuesText = (
	issues: readonly unknown[],
	prefix = "",
): string => {
	return issues.map((rawIssue) => {
		const issue = rawIssue as ValidationIssueLike;
		const field = issueField(issue);
		const path = prefix && field
			? `${prefix}.${field}`
			: prefix || field || "";
		const message = stringMessage(issue.message);

		return path ? `${path}: ${message}` : message;
	}).join("; ");
};

export const validationErrorDetails = (
	err: unknown,
	prefix = "",
): string | null => {
	if (!isRecord(err) || !Array.isArray(err.issues) || err.issues.length === 0) {
		return null;
	}

	return validationIssuesText(err.issues, prefix);
};

const normalizeFieldMessages = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.map(stringMessage);
	}

	return [stringMessage(value)];
};

export class FieldValidationError extends Error implements FormErrorSource {
	fieldErrors: FormFieldErrors;
	formErrors: string[];

	constructor(
		message: string,
		fieldErrors: FormFieldErrors = {},
		formErrors: string[] = [],
	) {
		super(message);
		this.name = "FieldValidationError";
		this.fieldErrors = fieldErrors;
		this.formErrors = formErrors;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export const isFieldValidationError = (
	err: unknown,
): err is FieldValidationError => {
	return err instanceof FieldValidationError;
};

export const fieldErrorsFromIssues = (
	issues: readonly unknown[],
): FormErrorSource => {
	const fieldErrors: FormFieldErrors = {};
	const formErrors: string[] = [];

	issues.forEach((rawIssue) => {
		const issue = rawIssue as ValidationIssueLike;
		const message = stringMessage(issue.message);
		const field = issueField(issue);

		if (!field) {
			formErrors.push(message);
			return;
		}

		fieldErrors[field] = [
			...(fieldErrors[field] ?? []),
			message,
		];
	});

	return {
		fieldErrors,
		formErrors,
	};
};

export const fieldErrorsFromApiBody = (
	body: unknown,
): FormErrorSource => {
	if (!isRecord(body)) {
		return {};
	}

	const fieldErrors: FormFieldErrors = {};
	const formErrors: string[] = [];

	const candidates = [
		body.field_errors,
		body.fieldErrors,
		body.fields,
	];

	candidates.forEach((candidate) => {
		if (!isRecord(candidate)) {
			return;
		}

		Object.entries(candidate).forEach(([field, messages]) => {
			fieldErrors[field] = [
				...(fieldErrors[field] ?? []),
				...normalizeFieldMessages(messages),
			];
		});
	});

	if (Array.isArray(body.errors)) {
		body.errors.forEach((item) => {
			if (!isRecord(item)) {
				formErrors.push(stringMessage(item));
				return;
			}

			const field = typeof item.field === "string"
				? item.field
				: typeof item.name === "string"
					? item.name
					: null;
			const message = stringMessage(item.message ?? item.error ?? item.text);

			if (!field) {
				formErrors.push(message);
				return;
			}

			fieldErrors[field] = [
				...(fieldErrors[field] ?? []),
				message,
			];
		});
	}

	const errorMessage = apiErrorMessageFromBody(body, undefined, "");
	if (errorMessage !== "") {
		formErrors.push(errorMessage);
	}

	return {
		fieldErrors,
		formErrors,
	};
};

export const formErrorsFromError = (
	err: unknown,
): FormErrorSource => {
	if (isFieldValidationError(err)) {
		const hasFieldErrors = Object.keys(err.fieldErrors).length > 0;

		return {
			fieldErrors: err.fieldErrors,
			formErrors: err.formErrors.length > 0
				? err.formErrors
				: hasFieldErrors
					? []
					: [err.message],
		};
	}

	const apiErr = err as ApiErrorLike;
	const fromBody = fieldErrorsFromApiBody(apiErr.body);
	if (
		Object.keys(fromBody.fieldErrors ?? {}).length > 0 ||
		(fromBody.formErrors?.length ?? 0) > 0
	) {
		return fromBody;
	}

	if (err instanceof Error) {
		return {
			formErrors: [err.message],
		};
	}

	return {
		formErrors: [String(err)],
	};
};

export const parseWithSchema = <TValue>(
	schema: v.GenericSchema<TValue>,
	value: unknown,
): TValue => {
	const result = v.safeParse(schema, value);

	if (result.success) {
		return result.output;
	}

	const source = fieldErrorsFromIssues(result.issues);
	throw new FieldValidationError(
		"form validation failed",
		source.fieldErrors,
		source.formErrors,
	);
};

export const createSchemaBeforeHook = <TValue>(
	schema: v.GenericSchema<TValue>,
): ((model: TValue) => TValue) => {
	return (model: TValue): TValue => {
		return parseWithSchema(schema, model);
	};
};
