import {
	APIError,
	apiErrorMessageFromBody,
} from "../api/Conn";

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const errorText = (err: unknown): string => {
	if (err instanceof APIError) {
		return apiErrorMessageFromBody(
			err.body,
			err.status,
			err.message || "unknown API error",
		);
	}

	if (err instanceof Error) {
		return err.message || "unknown error";
	}

	if (isRecord(err)) {
		return apiErrorMessageFromBody(err, undefined, "unknown error");
	}

	return String(err);
};
