import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";

/**
 * @file Telegram-слой приложения на grammY.
 *
 * Здесь собрана только логика Telegram: модерация входящих сообщений,
 * определение сценария ответа и безопасная отправка результата. Генерация
 * текста делегируется OpenAI-сервису.
 */

/**
 * @import { Context } from "grammy"
 */

/**
 * Возвращает текстовую часть сообщения: обычный текст или подпись к медиа.
 *
 * @param {Context["message"]} message - Telegram-сообщение из контекста grammY.
 * @returns {string} Текст сообщения или пустая строка.
 */
function getMessageText(message) {
  return message?.text ?? message?.caption ?? "";
}

/**
 * Обрезает входной текст до лимита, чтобы не отправлять в модель слишком
 * большие сообщения и не тратить лишние токены на очевидно избыточный ввод.
 *
 * @param {string} text - Исходный текст.
 * @param {number} maxLength - Максимальная длина в символах.
 * @returns {string} Обрезанный текст без внешних пробелов.
 */
function trimInput(text, maxLength) {
  return text.trim().slice(0, maxLength);
}

/**
 * Проверяет, содержит ли сообщение запрещённый текстовый фрагмент.
 *
 * @param {string} text - Текст или подпись сообщения.
 * @param {string[]} bannedFragments - Список запрещённых фрагментов.
 * @returns {boolean} `true`, если сообщение нужно удалить.
 */
function hasBannedFragment(text, bannedFragments) {
  const normalizedText = text.toLowerCase();

  return bannedFragments.some((fragment) =>
    normalizedText.includes(fragment.toLowerCase()),
  );
}

/**
 * Безопасно удаляет сообщение и подавляет ошибки прав доступа.
 *
 * @param {Context} ctx - Контекст grammY.
 * @returns {Promise<boolean>} `true`, если удаление прошло успешно.
 */
async function deleteIncomingMessage(ctx) {
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    return true;
  } catch (error) {
    console.error("Не удалось удалить сообщение:", error);
    return false;
  }
}

/**
 * Определяет, является ли автор исходного сообщения защищённым пользователем.
 *
 * @param {Context} ctx - Контекст grammY.
 * @param {Set<number>} protectedUserIds - Пользователи, на которых бот не отвечает через триггер.
 * @returns {boolean} `true`, если ответ нужно пропустить.
 */
function isProtectedReplyAuthor(ctx, protectedUserIds) {
  const authorId = ctx.message?.reply_to_message?.from?.id;

  if (!authorId) {
    return false;
  }

  return authorId === ctx.me.id || protectedUserIds.has(authorId);
}

/**
 * Проверяет сценарий группового ответа: пользователь отвечает символом-триггером
 * на текстовое сообщение или подпись к медиа.
 *
 * @param {Context} ctx - Контекст grammY.
 * @param {string} replyTrigger - Триггер из `.env`, например `!`.
 * @returns {boolean} `true`, если сообщение нужно обработать через OpenAI.
 */
function isReplyTriggerMessage(ctx, replyTrigger) {
  const reply = ctx.message?.reply_to_message;

  return Boolean(
    reply &&
      getMessageText(reply) &&
      ctx.message?.text?.trim() === replyTrigger,
  );
}

/**
 * Проверяет сценарий личного чата: бот отвечает на любое сообщение с текстом
 * или подписью к медиа.
 *
 * @param {Context} ctx - Контекст grammY.
 * @returns {boolean} `true`, если сообщение пришло в приватный чат.
 */
function isPrivateTextMessage(ctx) {
  return Boolean(getMessageText(ctx.message) && ctx.chat?.type === "private");
}

/**
 * Отправляет HTML-ответ и привязывает его к указанному сообщению.
 *
 * @param {Context} ctx - Контекст grammY.
 * @param {string} text - Текст ответа.
 * @param {number} replyToMessageId - Идентификатор сообщения для ответа.
 * @param {string} parseMode - Режим форматирования Telegram.
 * @returns {Promise<void>}
 */
async function replyWithGeneratedText(ctx, text, replyToMessageId, parseMode) {
  await ctx.reply(text, {
    reply_to_message_id: replyToMessageId,
    parse_mode: parseMode,
  });
}

/**
 * Обрабатывает сообщение, выбранное для генерации ответа.
 *
 * @param {{
 *   ctx: Context,
 *   sourceText: string,
 *   replyToMessageId: number,
 *   openAIService: { generateReply(message: string): Promise<string> },
 *   parseMode: string,
 *   maxInputLength: number
 * }} options - Данные для обработки одного сценария.
 * @returns {Promise<void>}
 */
async function generateAndReply(options) {
  const input = trimInput(options.sourceText, options.maxInputLength);

  if (!input) {
    return;
  }

  const generatedText = await options.openAIService.generateReply(input);

  await replyWithGeneratedText(
    options.ctx,
    generatedText,
    options.replyToMessageId,
    options.parseMode,
  );
}

/**
 * Создаёт и настраивает экземпляр Telegram-бота.
 *
 * @param {{
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
 *   moderation: {
 *     bannedTextFragments: string[]
 *   },
 *   app: {
 *     maxInputLength: number
 *   }
 * }} settings - Настройки из `.env`.
 * @param {{ generateReply(message: string): Promise<string> }} openAIService - Сервис генерации ответов.
 * @returns {Bot} Настроенный бот grammY.
 */
export function createTelegramBot(settings, openAIService) {
  const botOptions = settings.telegram.apiRoot
    ? { client: { apiRoot: settings.telegram.apiRoot } }
    : undefined;

  const bot = new Bot(settings.telegram.token, botOptions);

  bot.api.config.use(autoRetry({ retries: settings.telegram.retryCount }));

  bot.catch((error) => {
    console.error("Ошибка в обработчике grammY:", error);
  });

  bot.on("message", async (ctx) => {
    const incomingText = getMessageText(ctx.message);

    if (
      incomingText &&
      hasBannedFragment(incomingText, settings.moderation.bannedTextFragments)
    ) {
      await deleteIncomingMessage(ctx);
      return;
    }

    if (isReplyTriggerMessage(ctx, settings.telegram.replyTrigger)) {
      await deleteIncomingMessage(ctx);

      if (isProtectedReplyAuthor(ctx, settings.telegram.protectedUserIds)) {
        return;
      }

      await generateAndReply({
        ctx,
        sourceText: getMessageText(ctx.message.reply_to_message),
        replyToMessageId: ctx.message.reply_to_message.message_id,
        openAIService,
        parseMode: settings.telegram.parseMode,
        maxInputLength: settings.app.maxInputLength,
      });

      return;
    }

    if (isPrivateTextMessage(ctx)) {
      await generateAndReply({
        ctx,
        sourceText: incomingText,
        replyToMessageId: ctx.message.message_id,
        openAIService,
        parseMode: settings.telegram.parseMode,
        maxInputLength: settings.app.maxInputLength,
      });
    }
  });

  return bot;
}
