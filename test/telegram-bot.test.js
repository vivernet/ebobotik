import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramBot } from "../src/telegram-bot.js";

const settings = {
  telegram: {
    token: "test-token",
    retryCount: 0,
    parseMode: "HTML",
    replyTrigger: "!",
    protectedUserIds: new Set(),
  },
  moderation: {
    bannedTextFragments: [],
  },
  app: {
    maxInputLength: 4_000,
  },
};

function createTestBot(service, calls) {
  const bot = createTelegramBot(settings, service);
  bot.botInfo = {
    id: 42,
    is_bot: true,
    first_name: "Тестовый бот",
    username: "TestGuestBot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: { inline_message_id: "guest-message" } };
  });

  return bot;
}

test("guest_message передаёт текст реплая как контекст и отвечает через answerGuestQuery", async () => {
  const requests = [];
  const calls = [];
  const bot = createTestBot(
    {
      async generateReply(input) {
        requests.push(input);
        return "Готово";
      },
    },
    calls,
  );

  await bot.handleUpdate({
    update_id: 1,
    guest_message: {
      message_id: 10,
      date: 1,
      guest_query_id: "guest-query",
      chat: { id: -100, type: "supergroup", title: "Чат" },
      from: { id: 1, is_bot: false, first_name: "Анна" },
      text: "@TestGuestBot объясни",
      entities: [{ type: "mention", offset: 0, length: 13 }],
      reply_to_message: {
        message_id: 9,
        date: 1,
        chat: { id: -100, type: "supergroup", title: "Чат" },
        text: "Исходный текст",
      },
    },
  });

  assert.deepEqual(requests, [
    "Контекст сообщения, на которое ответил пользователь:\nИсходный текст\n\nЗапрос пользователя:\nобъясни",
  ]);
  assert.deepEqual(calls, [
    {
      method: "answerGuestQuery",
      payload: {
        guest_query_id: "guest-query",
        result: {
          type: "article",
          id: calls[0].payload.result.id,
          title: "Ответ",
          input_message_content: {
            message_text: "Готово",
            parse_mode: "HTML",
          },
        },
      },
    },
  ]);
  assert.match(calls[0].payload.result.id, /^[0-9a-f-]{36}$/);
});

test("упоминание бота в группе обрабатывается как личное сообщение", async () => {
  const requests = [];
  const calls = [];
  const bot = createTestBot(
    {
      async generateReply(input) {
        requests.push(input);
        return "Ответ";
      },
    },
    calls,
  );

  await bot.handleUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      date: 1,
      chat: { id: -100, type: "supergroup", title: "Чат" },
      from: { id: 1, is_bot: false, first_name: "Анна" },
      text: "@TestGuestBot привет",
      entities: [{ type: "mention", offset: 0, length: 13 }],
    },
  });

  assert.deepEqual(requests, ["привет"]);
  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].payload.chat_id, -100);
  assert.equal(calls[0].payload.reply_to_message_id, 11);
});
