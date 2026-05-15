import OpenAI from "openai";

/**
 * @file Тонкая обёртка над официальным SDK OpenAI.
 *
 * Модуль изолирует сетевой код от Telegram-логики: обработчик сообщений знает
 * только о методе `generateReply`, а детали модели, таймаутов и параметров
 * запроса остаются в одном месте.
 */

/**
 * Создаёт официальный клиент OpenAI с настройками из окружения.
 *
 * @param {{
 *   apiKey: string,
 *   baseURL?: string,
 *   maxRetries: number,
 *   timeoutMs: number
 * }} options - Параметры подключения к OpenAI API.
 * @returns {OpenAI} Готовый клиент OpenAI.
 */
export function createOpenAIClient(options) {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: options.maxRetries,
    timeout: options.timeoutMs,
  });
}

/**
 * Сервис генерации ответов через Chat Completions.
 */
export class OpenAIReplyService {
  /**
   * @param {{
   *   client: OpenAI,
   *   model: string,
   *   systemPrompt: string,
   *   maxCompletionTokens: number,
   *   temperature?: number
   * }} options - Настройки генерации.
   */
  constructor(options) {
    /**
     * Официальный клиент OpenAI.
     *
     * @private
     * @type {OpenAI}
     */
    this.client = options.client;

    /**
     * Идентификатор модели OpenAI.
     *
     * @private
     * @type {string}
     */
    this.model = options.model;

    /**
     * Системная инструкция, задающая личность и правила бота.
     *
     * @private
     * @type {string}
     */
    this.systemPrompt = options.systemPrompt;

    /**
     * Максимальный размер ответа модели в токенах.
     *
     * @private
     * @type {number}
     */
    this.maxCompletionTokens = options.maxCompletionTokens;

    /**
     * Температура генерации. Для некоторых моделей параметр может быть пустым,
     * поэтому он добавляется в запрос только при явной настройке в `.env`.
     *
     * @private
     * @type {number | undefined}
     */
    this.temperature = options.temperature;
  }

  /**
   * Генерирует ответ на пользовательский текст.
   *
   * @param {string} message - Текст или подпись Telegram-сообщения.
   * @returns {Promise<string>} Непустой ответ модели без внешних пробелов.
   * @throws {Error} Если OpenAI API вернул ошибку или пустой ответ.
   */
  async generateReply(message) {
    const request = {
      model: this.model,
      max_completion_tokens: this.maxCompletionTokens,
      messages: [
        {
          role: "system",
          content: this.systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],
    };

    if (this.temperature !== undefined) {
      request.temperature = this.temperature;
    }

    const response = await this.client.chat.completions.create(request);
    const text = response.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("OpenAI API вернул пустой ответ");
    }

    return text;
  }
}

/**
 * Создаёт сервис генерации ответов из готового конфигурационного объекта.
 *
 * @param {{
 *   apiKey: string,
 *   baseURL?: string,
 *   model: string,
 *   maxRetries: number,
 *   timeoutMs: number,
 *   maxCompletionTokens: number,
 *   temperature?: number,
 *   systemPrompt: string
 * }} options - Настройки OpenAI из `.env`.
 * @returns {OpenAIReplyService} Сервис ответов.
 */
export function createOpenAIReplyService(options) {
  const client = createOpenAIClient(options);

  return new OpenAIReplyService({
    client,
    model: options.model,
    systemPrompt: options.systemPrompt,
    maxCompletionTokens: options.maxCompletionTokens,
    temperature: options.temperature,
  });
}
