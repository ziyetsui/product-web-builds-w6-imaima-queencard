/**
 * Load translation messages for a given locale
 */
async function getMessagesForLocale(locale: string) {
  try {
    const messages = (await import(`@/messages/${locale}.json`)).default;
    return messages;
  } catch (error) {
    // Fallback to default locale (en) if translation not found
    console.warn(`Translation for locale "${locale}" not found, falling back to "en"`);
    const defaultMessages = (await import(`@/messages/en.json`)).default;
    return defaultMessages;
  }
}

/**
 * Export for use in request.ts
 */
export { getMessagesForLocale };
