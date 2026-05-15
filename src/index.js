import { config } from "./config.js";
import { createOpenAIReplyService } from "./openai-service.js";
import { createTelegramBot } from "./telegram-bot.js";
import { run } from "@grammyjs/runner";

/**
 * @file Точка входа приложения.
 *
 * Модуль собирает конфигурацию, OpenAI-сервис и Telegram-бота, запускает
 * производительный long polling через grammY runner и корректно завершает
 * процесс по системным сигналам.
 */

/**
 * Ожидает завершения промиса не дольше заданного времени.
 *
 * @param {Promise<void>} promise - Операция завершения бота.
 * @param {number} timeoutMs - Максимальное время ожидания в миллисекундах.
 * @returns {Promise<void>}
 */
async function withTimeout(promise, timeoutMs) {
  const timeout = new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

  await Promise.race([promise, timeout]);
}

/**
 * Запускает приложение и регистрирует обработчики штатного завершения.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const openAIService = createOpenAIReplyService(config.openai);
  const bot = createTelegramBot(config, openAIService);
  const runner = run(bot, {
    runner: {
      fetch: {
        timeout: config.telegram.pollingTimeoutSeconds,
        allowed_updates: config.telegram.allowedUpdates,
      },
    },
    sink: {
      concurrency: config.telegram.runnerConcurrency,
    },
  });

  const stopBot = async (signal) => {
    console.log(`Получен сигнал ${signal}. Останавливаю Telegram-бота...`);
    await withTimeout(runner.stop(), config.app.shutdownTimeoutMs);
    console.log("Telegram-бот остановлен.");
  };

  process.once("SIGINT", () => {
    void stopBot("SIGINT");
  });

  process.once("SIGTERM", () => {
    void stopBot("SIGTERM");
  });

  await runner.task();
}

main().catch((error) => {
  console.error("Критическая ошибка запуска приложения:", error);
  process.exitCode = 1;
});
