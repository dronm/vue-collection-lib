import type { I18n } from "vue-i18n";

interface I18nTranslator {
	t: (
		key: string,
		params?: Record<string, unknown>,
	) => string;
}

let i18nInstance: unknown = null;

export const setI18n = <
	TMessages extends Record<string, unknown>,
	TDateTimeFormats extends Record<string, unknown>,
	TNumberFormats extends Record<string, unknown>,
	TLocale,
	TLegacy extends boolean,
>(
	instance: I18n<
		TMessages,
		TDateTimeFormats,
		TNumberFormats,
		TLocale,
		TLegacy
	>,
): void => {
	i18nInstance = instance;
};

export const t = (
	key: string,
	params: Record<string, unknown> = {},
): string => {
	if (!i18nInstance) {
		console.warn("[Library] i18n instance is not set. Returning the key.");
		return key;
	}

	const { global } = i18nInstance as {
		global: I18nTranslator;
	};

	return global.t(key, params);
};
