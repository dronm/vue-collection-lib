import type { I18n } from "vue-i18n";

import { collectionLibMessages } from "./locales";

interface LocaleMessageMerger {
	mergeLocaleMessage: (
		locale: string,
		messages: Record<string, unknown>,
	) => void;
}

export const installCollectionLibMessages = <
	TMessages extends Record<string, unknown>,
	TDateTimeFormats extends Record<string, unknown>,
	TNumberFormats extends Record<string, unknown>,
	TLocale,
	TLegacy extends boolean,
>(
	i18n: I18n<
		TMessages,
		TDateTimeFormats,
		TNumberFormats,
		TLocale,
		TLegacy
	>,
): void => {
	const global = i18n.global as unknown as LocaleMessageMerger;

	Object.entries(collectionLibMessages).forEach(([locale, messages]) => {
		global.mergeLocaleMessage(locale, messages);
	});
};
