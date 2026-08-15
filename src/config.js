import "dotenv/config";

/**
 * @file Модуль загрузки и проверки переменных окружения.
 *
 * В проекте нет захардкоженных поведенческих настроек: токены, модель,
 * системный промпт, лимиты, таймауты, триггеры и списки фильтрации берутся
 * из `.env`. Такой подход упрощает перенос бота между окружениями и снижает
 * риск случайно закоммитить секреты.
 */

/**
 * Регулярное выражение для декодирования Unicode-последовательностей вида
 * `\u200B` в переменных окружения. Оно полезно для невидимых символов,
 * например zero-width space, которые неудобно хранить в `.env` напрямую.
 *
 * @type {RegExp}
 */
const UNICODE_ESCAPE_PATTERN = /\\u([0-9a-fA-F]{4})/g;

/**
 * Возвращает обязательную переменную окружения или завершает запуск понятной
 * ошибкой до инициализации Telegram/OpenAI клиентов.
 *
 * @param {string} name - Имя переменной окружения.
 * @returns {string} Непустое значение переменной.
 * @throws {Error} Если переменная отсутствует или содержит только пробелы.
 */
function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }

  return value;
}

/**
 * Возвращает строковую переменную окружения с запасным значением.
 *
 * @param {string} name - Имя переменной окружения.
 * @param {string} fallback - Значение, используемое при пустой переменной.
 * @returns {string} Итоговая строка без внешних пробелов.
 */
function stringEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

/**
 * Возвращает необязательную строковую переменную окружения.
 *
 * @param {string} name - Имя переменной окружения.
 * @returns {string | undefined} Строка без внешних пробелов или `undefined`.
 */
function optionalStringEnv(name) {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

/**
 * Возвращает целочисленную переменную окружения с проверкой диапазона.
 *
 * @param {string} name - Имя переменной окружения.
 * @param {number} fallback - Значение по умолчанию.
 * @param {{ min?: number, max?: number }} [range] - Допустимый диапазон.
 * @returns {number} Проверенное целое число.
 * @throws {Error} Если значение не является целым числом или выходит за диапазон.
 */
function integerEnv(name, fallback, range = {}) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value)) {
    throw new Error(`Переменная ${name} должна быть целым числом`);
  }

  if (range.min !== undefined && value < range.min) {
    throw new Error(`Переменная ${name} должна быть не меньше ${range.min}`);
  }

  if (range.max !== undefined && value > range.max) {
    throw new Error(`Переменная ${name} должна быть не больше ${range.max}`);
  }

  return value;
}

/**
 * Возвращает дробную переменную окружения с проверкой диапазона.
 *
 * @param {string} name - Имя переменной окружения.
 * @returns {number | undefined} Проверенное число или `undefined`, если переменная пуста.
 * @throws {Error} Если значение не является числом или выходит за диапазон `0..2`.
 */
function optionalTemperatureEnv(name) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number.parseFloat(rawValue);

  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`Переменная ${name} должна быть числом от 0 до 2`);
  }

  return value;
}

/**
 * Декодирует Unicode-последовательности в одном элементе списка.
 *
 * @param {string} value - Значение из переменной окружения.
 * @returns {string} Значение с раскрытыми `\uXXXX` последовательностями.
 */
function decodeUnicodeEscapes(value) {
  return value.replace(UNICODE_ESCAPE_PATTERN, (_, hexCode) =>
    String.fromCharCode(Number.parseInt(hexCode, 16)),
  );
}

/**
 * Разбирает список строк, разделённых запятыми.
 *
 * @param {string} name - Имя переменной окружения.
 * @param {string[]} fallback - Список по умолчанию.
 * @returns {string[]} Очищенный список непустых строк.
 */
function stringListEnv(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue?.trim()) {
    return fallback;
  }

  return rawValue
    .split(",")
    .map((value) => decodeUnicodeEscapes(value.trim()))
    .filter(Boolean);
}

/**
 * Разбирает список числовых идентификаторов Telegram, разделённых запятыми.
 *
 * @param {string} name - Имя переменной окружения.
 * @param {number[]} fallback - Список по умолчанию.
 * @returns {Set<number>} Набор Telegram user id.
 * @throws {Error} Если хотя бы один элемент не является целым числом.
 */
function idSetEnv(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue?.trim()) {
    return new Set(fallback);
  }

  const ids = rawValue
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10));

  if (ids.some((id) => !Number.isInteger(id))) {
    throw new Error(`Переменная ${name} должна содержать Telegram id через запятую`);
  }

  return new Set(ids);
}

/**
 * Настройки приложения, сгруппированные по внешним сервисам и сценариям.
 *
 * @type {{
 *   telegram: {
 *     token: string,
 *     apiRoot?: string,
 *     retryCount: number,
 *     runnerConcurrency: number,
 *     pollingTimeoutSeconds: number,
 *     allowedUpdates: string[],
 *     replyTrigger: string,
 *     parseMode: string,
 *     protectedUserIds: Set<number>
 *   },
 *   openai: {
 *     apiKey: string,
 *     baseURL?: string,
 *     model: string,
 *     maxRetries: number,
 *     timeoutMs: number,
 *     maxCompletionTokens: number,
 *     temperature?: number,
 *     systemPrompt: string
 *   },
 *   moderation: {
 *     bannedTextFragments: string[]
 *   },
 *   app: {
 *     maxInputLength: number,
 *     shutdownTimeoutMs: number
 *   }
 * }}
 */
export const config = Object.freeze({
  telegram: Object.freeze({
    token: requireEnv("TELEGRAM_BOT_TOKEN"),
    apiRoot: optionalStringEnv("TELEGRAM_BOT_API_URL"),
    retryCount: integerEnv("TELEGRAM_API_RETRY_COUNT", 1, { min: 0, max: 10 }),
    runnerConcurrency: integerEnv("TELEGRAM_RUNNER_CONCURRENCY", 50, {
      min: 1,
    }),
    pollingTimeoutSeconds: integerEnv("TELEGRAM_POLLING_TIMEOUT_SECONDS", 30, {
      min: 1,
      max: 50,
    }),
    allowedUpdates: Array.from(
      new Set([
        ...stringListEnv("TELEGRAM_ALLOWED_UPDATES", ["message"]),
        "guest_message",
      ]),
    ),
    replyTrigger: stringEnv("REPLY_TRIGGER", "!"),
    parseMode: stringEnv("TELEGRAM_PARSE_MODE", "HTML"),
    protectedUserIds: idSetEnv("PROTECTED_USER_IDS", [1087968824]),
  }),
  openai: Object.freeze({
    apiKey: requireEnv("OPENAI_API_KEY"),
    baseURL: optionalStringEnv("OPENAI_BASE_URL"),
    model: stringEnv("OPENAI_MODEL", "gpt-5.4-nano"),
    maxRetries: integerEnv("OPENAI_MAX_RETRIES", 1, { min: 0, max: 10 }),
    timeoutMs: integerEnv("OPENAI_TIMEOUT_MS", 30_000, { min: 1_000 }),
    maxCompletionTokens: integerEnv("OPENAI_MAX_COMPLETION_TOKENS", 1_000, {
      min: 1,
    }),
    temperature: optionalTemperatureEnv("OPENAI_TEMPERATURE"),
    systemPrompt: requireEnv("SYSTEM_PROMPT"),
  }),
  moderation: Object.freeze({
    bannedTextFragments: stringListEnv("BANNED_TEXT_FRAGMENTS", [
      "\u200B",
      "пидарасов",
    ]),
  }),
  app: Object.freeze({
    maxInputLength: integerEnv("MAX_INPUT_LENGTH", 4_000, { min: 1 }),
    shutdownTimeoutMs: integerEnv("SHUTDOWN_TIMEOUT_MS", 10_000, {
      min: 1_000,
    }),
  }),
});
