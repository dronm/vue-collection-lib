/*
 * MIT License
 *
 * Copyright (c) 2025 Andrey Mikhalevich
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 */

export type RequestHeaders = Record<string, string>;

export interface HTTPResponse<T = any> {
	body: T;
	attachment: Blob | undefined;
	status: number;
	headers: Headers;
}

export interface APIErrorDetails {
	code?: unknown;
	[key: string]: unknown;
}

export interface APIErrorObject {
	code?: unknown;
	message?: unknown;
	details?: APIErrorDetails;
	[key: string]: unknown;
}

export interface APIErrorBody {
	error?: string | APIErrorObject;
	message?: unknown;
	details?: APIErrorDetails;
	field_errors?: unknown;
	fieldErrors?: unknown;
	fields?: unknown;
	errors?: unknown;
	[key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const cleanString = (value: unknown): string => {
	return typeof value === "string" ? value.trim() : "";
};

const detailsCode = (value: unknown): string => {
	if (!isRecord(value)) {
		return "";
	}

	return cleanString(value.code);
};

export const apiErrorMessageFromBody = (
	body: unknown,
	status?: number,
	fallback = "request error",
): string => {
	const textBody = cleanString(body);
	if (textBody !== "") {
		return textBody;
	}

	if (!isRecord(body)) {
		return status ? `${fallback} (${status})` : fallback;
	}

	const error = body.error;
	if (typeof error === "string" && error.trim() !== "") {
		return error.trim();
	}

	if (isRecord(error)) {
		const message = cleanString(error.message);
		const code = cleanString(error.code);
		const codeFromDetails = detailsCode(error.details) || detailsCode(body.details);

		if (message !== "" && codeFromDetails !== "") {
			return `${message} (${codeFromDetails})`;
		}

		if (message !== "") {
			return message;
		}

		if (code !== "") {
			return status ? `${fallback} (${status}, ${code})` : `${fallback} (${code})`;
		}
	}

	const message = cleanString(body.message);
	if (message !== "") {
		return message;
	}

	return status ? `${fallback} (${status})` : fallback;
};

// APIError is thrown is case of an error. It extends default Error class
// with status and body fields.
export class APIError extends Error {
	status?: number;
	body?: unknown;

	constructor(message: string, status?: number, body?: unknown) {
		super(message); // Call the parent constructor with the message
		this.name = this.constructor.name; // Set the error name to the class name
		this.status = status;
		this.body = body;

		// Set the prototype explicitly for inheritance to work correctly in TypeScript
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export const RequestMethods = {
	Get: "GET",
	Post: "POST",
	Put: "PUT",
	Delete: "DELETE",
	Patch: "PATCH",
}
export type RequestMethods = (typeof RequestMethods)[keyof typeof RequestMethods];

//----- types -----
//
interface GetParams {
	[key: string]: unknown;
}

export const RequestContentTypes = {
	TEXT: "text/html",
	JSON: "application/json",
	FORM: "multipart/form-data",
	XML: "text/xml",
	ARRAY_BUFFER: "arraybuffer",
	BLOB: "blob",
}
export type RequestContentTypes = (typeof RequestContentTypes)[keyof typeof RequestContentTypes];

//----- class -----
export interface ConnRequestOptions {
	timeout?: number;
	signal?: AbortSignal;
}

interface ActiveAbortListener {
	signal: AbortSignal;
	listener: () => void;
}

//----- class -----
export class Conn {
	static DEF_TIMEOUT = 1000;

	baseURL: string;
	timeout: number;
	defaultHTTPHeaders: RequestHeaders;

	public response: HTTPResponse;

	constructor(baseURL: string, timeout?: number) {
		this.baseURL = baseURL.replace(/\/+$/, "");
		this.timeout = timeout ?? Conn.DEF_TIMEOUT;
		this.defaultHTTPHeaders = {
			Accept: "application/json",
		};

		this.response = { body: null, status: 0, headers: new Headers(), attachment: undefined };
	}

	protected buildUrl(endpoint: string): string {
		if (/^https?:\/\//i.test(endpoint)) {
			return endpoint;
		}

		const path = endpoint.replace(/^\/+/, "");

		return `${this.baseURL}/${path}`;
	}

	protected async request<T = any>(
		endpoint: string,
		options: RequestInit,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		const url = this.buildUrl(endpoint);
		const timeout = requestOptions.timeout ?? this.timeout;

		const controller = new AbortController();
		const abortListeners: ActiveAbortListener[] = [];
		let timeoutID: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;

		const addAbortForwarder = (signal?: AbortSignal): void => {
			if (!signal) {
				return;
			}

			if (signal.aborted) {
				controller.abort();
				return;
			}

			const listener = (): void => {
				controller.abort();
			};

			signal.addEventListener("abort", listener, { once: true });
			abortListeners.push({ signal, listener });
		};

		addAbortForwarder(options.signal ?? undefined);
		addAbortForwarder(requestOptions.signal);

		if (timeout > 0) {
			timeoutID = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, timeout);
		}

		try {
			const res = await fetch(url, {
				...options,
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					...(options.headers || {}),
				},
			});

			const contentType = res.headers.get("Content-Type");
			const isJson = contentType?.includes(RequestContentTypes.JSON);

			let isAttachment = false;
			if (!isJson) {
				const disposition = res.headers.get("Content-Disposition");
				isAttachment = disposition?.includes("attachment") ?? false;
			}

			const isNoContent = res.status === 204 || res.status === 205;

			let body: unknown = null;
			if (!isNoContent && isJson) {
				body = await res.json();
			} else if (!isNoContent && !isAttachment && !res.ok) {
				const text = await res.text();
				body = text.trim() || null;
			}

			this.response = {
				body: body as T,
				status: res.status,
				headers: res.headers,
				attachment: isAttachment ? await res.blob() : undefined,
			};

			if (!res.ok) {
				throw new APIError(
					apiErrorMessageFromBody(body, res.status),
					res.status,
					body,
				);
			}

			return body as T;
		} catch (error) {
			if (timedOut) {
				throw new APIError(
					`request timeout after ${timeout} ms`,
					undefined,
					{
						error: {
							code: "request_timeout",
							message: `request timeout after ${timeout} ms`,
						},
					},
				);
			}

			throw error;
		} finally {
			if (timeoutID) {
				clearTimeout(timeoutID);
			}

			abortListeners.forEach(({ signal, listener }) => {
				signal.removeEventListener("abort", listener);
			});
		}
	}

	public async get<T = any>(
		endpoint: string,
		params?: GetParams,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		const finalEndpoint = this.buildEndpointWithParams(endpoint, params);

		const body = await this.request<T>(
			finalEndpoint,
			{
				method: RequestMethods.Get,
				headers: {
					...this.defaultHTTPHeaders,
					"X-Query-Id": makeQueryId(),
				},
			},
			requestOptions,
		);

		if (!this.response.attachment) {
			return body;
		}

		const disposition = this.response.headers.get("Content-Disposition");
		if (!disposition) {
			return undefined as unknown as T;
		}

		let filename = "download";

		let match = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
		if (match) {
			filename = decodeURIComponent(match[1].trim().replace(/^"|"$/g, ""));
		} else {
			match = disposition.match(/filename="?([^";]+)"?/i);
			if (match) {
				filename = match[1].trim();
			}
		}

		const blobUrl = URL.createObjectURL(this.response.attachment);

		const a = document.createElement("a");
		a.href = blobUrl;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);

		URL.revokeObjectURL(blobUrl);

		return undefined as unknown as T;
	}

	private buildEndpointWithParams(endpoint: string, params?: GetParams): string {
		const url = this.makeInternalUrl(endpoint);

		if (params) {
			Object.entries(params).forEach(([key, value]) => {
				if (value === undefined || value === null) {
					return;
				}

				let paramValue: string;

				if (typeof value === "string") {
					paramValue = value;
				} else if (typeof value === "number" || typeof value === "boolean") {
					paramValue = value.toString();
				} else {
					paramValue = JSON.stringify(value);
				}

				url.searchParams.append(key, paramValue);

			});
		}

		return this.makeRelativeEndpoint(url);
	}

	private makeInternalUrl(endpoint: string): URL {
		const baseUrl = new URL(this.baseURL.endsWith("/") ? this.baseURL : `${this.baseURL}/`);
		const basePath = baseUrl.pathname.replace(/^\/+|\/+$/g, "");

		if (/^https?:\/\//i.test(endpoint)) {
			return new URL(endpoint);
		}

		let path = endpoint.trim();

		path = path.replace(/^\/+/, "");

		if (basePath !== "" && (path === basePath || path.startsWith(`${basePath}/`))) {
			path = path.slice(basePath.length).replace(/^\/+/, "");
		}

		return new URL(path, baseUrl);
	}

	private makeRelativeEndpoint(url: URL): string {
		const baseUrl = new URL(this.baseURL.endsWith("/") ? this.baseURL : `${this.baseURL}/`);
		const basePath = baseUrl.pathname.replace(/\/+$/, "");

		if (url.origin !== baseUrl.origin) {
			return url.toString();
		}

		if (!url.pathname.startsWith(basePath)) {
			return `${url.pathname}${url.search}`;
		}

		const path = url.pathname.slice(basePath.length) || "/";

		return `${path.startsWith("/") ? path : `/${path}`}${url.search}`;
	}

	public post<T = any>(
		endpoint: string,
		data?: any,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				method: RequestMethods.Post,
				body: data === undefined ? undefined : JSON.stringify(data),
				headers: {
					...this.defaultHTTPHeaders,
					"Content-Type": "application/json",
					"X-Query-Id": makeQueryId(),
				},
			},
			requestOptions,
		);
	}

	public postForm<T = any>(
		endpoint: string,
		data: FormData,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				method: RequestMethods.Post,
				body: data,
				headers: {
					...this.defaultHTTPHeaders,
					"X-Query-Id": makeQueryId(),
				},
			},
			requestOptions,
		);
	}

	public patch<T = any>(
		endpoint: string,
		data?: any,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				method: RequestMethods.Patch,
				body: data === undefined ? undefined : JSON.stringify(data),
				headers: {
					...this.defaultHTTPHeaders,
					"Content-Type": "application/json",
					"X-Query-Id": makeQueryId(),
				},
			},
			requestOptions,
		);
	}

	public delete<T = any>(
		endpoint: string,
		data?: any,
		requestOptions: ConnRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			endpoint,
			{
				method: RequestMethods.Delete,
				body: data === undefined ? undefined : JSON.stringify(data),
				headers: {
					...this.defaultHTTPHeaders,
					"Content-Type": "application/json",
					"X-Query-Id": makeQueryId(),
				},
			},
			requestOptions,
		);
	}
}

const makeQueryId = (): string => {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
