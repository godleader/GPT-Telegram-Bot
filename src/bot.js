const { Bot, InlineKeyboard } = require('grammy');
const { Redis } = require('@upstash/redis');
const { 
  TELEGRAM_BOT_TOKEN, 
  WHITELISTED_USERS, 
  OPENAI_MODELS, 
  GOOGLE_MODELS,
  GROQ_MODELS,
  CLAUDE_MODELS,
  AZURE_OPENAI_MODELS,
  DEFAULT_MODEL,
  OPENAI_API_KEY,
  GEMINI_API_KEY,
  GROQ_API_KEY,
  CLAUDE_API_KEY,
  AZURE_OPENAI_API_KEY,
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN
} = require('./config');
const { generateResponse, generateStreamResponse } = require('./api');
const { generateGeminiResponse } = require('./geminiApi');
const { generateGroqResponse } = require('./groqapi');
const { generateClaudeResponse } = require('./claude');
const { generateAzureOpenAIResponse } = require('./azureOpenAI');
const { getConversationHistory, addToConversationHistory, clearConversationHistory, getSummarizedConversationHistory } = require('./redis');
const { generateImage, VALID_SIZES } = require('./generateImage');
const { handleImageUpload } = require('./uploadHandler');
const { getUserLanguage, setUserLanguage, translate, supportedLanguages, getLocalizedCommands } = require('./localization');

let currentModel = OPENAI_API_KEY ? DEFAULT_MODEL : null;

const bot = new Bot(TELEGRAM_BOT_TOKEN);

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

// Telegram Business feature
bot.on("business_message", async (ctx) => {
  const conn = await ctx.getBusinessConnection();
  const employee = conn.user;

  if (ctx.from.id === employee.id) {
    await ctx.reply("You sent this message.");
  } else {
    await ctx.reply("Your customer sent this message.");
  }
});

// Automatically respond to customer questions
bot.on("business_message").filter(
  async (ctx) => {
    const conn = await ctx.getBusinessConnection();
    return ctx.from.id !== conn.user.id;
  },
  async (ctx) => {
    if (ctx.msg.text.endsWith("?")) {
      await ctx.reply("We will get back to you soon.");
    }
  }
);

bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);
  await ctx.reply(translate('welcome', userLang, { model: currentModel }));
});

bot.command('new', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);
  await clearConversationHistory(userId);
  await ctx.reply(translate('new_conversation', userLang, { model: currentModel }));
});

bot.command('history', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);
  const summarizedHistory = await getSummarizedConversationHistory(userId, currentModel);
  if (!summarizedHistory) {
    await ctx.reply(translate('no_history', userLang));
    return;
  }
  await ctx.reply(translate('history_intro', userLang) + summarizedHistory);
});

bot.command('help', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);
  const availableModels = [
    ...(OPENAI_API_KEY ? OPENAI_MODELS : []),
    ...(GEMINI_API_KEY ? GOOGLE_MODELS : []),
    ...(GROQ_API_KEY ? GROQ_MODELS : []),
    ...(CLAUDE_API_KEY ? CLAUDE_MODELS : []),
    ...(AZURE_OPENAI_API_KEY ? AZURE_OPENAI_MODELS : [])
  ];
  const helpMessage = translate('help_message', userLang, {
    models: availableModels.join(', '),
    current_model: currentModel
  });
  await ctx.reply(helpMessage);
});

bot.command('switchmodel', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);
  const args = ctx.message.text.split(' ');
  const availableModels = [
    ...(OPENAI_API_KEY ? OPENAI_MODELS : []),
    ...(GEMINI_API_KEY ? GOOGLE_MODELS : []),
    ...(GROQ_API_KEY ? GROQ_MODELS : []),
    ...(CLAUDE_API_KEY ? CLAUDE_MODELS : []),
    ...(AZURE_OPENAI_API_KEY ? AZURE_OPENAI_MODELS : [])
  ];

  if (args.length < 2) {
    await ctx.reply(translate('forgot_model_name', userLang, { available_models: availableModels.join(', ') }));
    return;
  }

  const modelName = args[1].trim();
  if (availableModels.includes(modelName)) {
    currentModel = modelName;
    await clearConversationHistory(userId);
    await ctx.reply(translate('model_switched', userLang, { model: modelName }));
  } else {
    await ctx.reply(translate('invalid_model', userLang, { available_models: availableModels.join(', ') }));
  }
});

bot.command('img', async (ctx) => {
  const userId = ctx.from.id;
  const userLang = await getUserLanguage(userId);

  const args = ctx.message.text.split(' ').slice(1);
  let size = '1024x1024';
  const possibleSize = args[args.length - 1];
  
  if (possibleSize && VALID_SIZES.includes(possibleSize)) {
    size = possibleSize;
    args.pop();
  }

  const prompt = args.join(' ').trim();
  if (!prompt) {
    await ctx.reply(translate('no_image_description', userLang));
    return;
  }

  try {
    await ctx.reply(translate('processing_image', userLang));
    const imageUrl = await generateImage(prompt, size);
    await ctx.replyWithPhoto(imageUrl, { caption: prompt });
  } catch (error) {
    await ctx.reply(translate('error_message', userLang));
  }
});

bot.command('language', async (ctx) => {
  const userId = ctx.from.id;
  const currentLang = await getUserLanguage(userId);
  const keyboard = new InlineKeyboard();
  
  supportedLanguages.forEach(lang => {
    keyboard.text(translate(lang, currentLang), `lang_${lang}`);
  });

  await ctx.reply(translate('choose_language', currentLang), { reply_markup: keyboard });
});

bot.callbackQuery(/lang_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const newLang = ctx.match[1];
  
  if (await setUserLanguage(userId, newLang)) {
    await ctx.answerCallbackQuery({ text: translate('language_set', newLang) });
    await ctx.reply(translate('language_changed', newLang));
  }
});

bot.on('message', async (ctx) => {
  const userId = ctx.from.id;
  if (!WHITELISTED_USERS.includes(userId)) {
    await ctx.reply('Sorry, you are not authorized to use this bot.');
    return;
  }

  if (ctx.message.photo) {
    await handleImageUpload(ctx);
  } else if (ctx.message.text) {
    await handleStreamMessage(ctx);
  }
});

// Start the bot
bot.start();

