const TelegramBot = require('node-telegram-bot-api');
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
const { getConversationHistory, addToConversationHistory, clearConversationHistory, businessMessage, getBusinessConnection, getSummarizedConversationHistory } = require('./redis');
const { generateImage, VALID_SIZES } = require('./generateImage');
const { handleImageUpload } = require('./uploadHandler');
const { getUserLanguage, setUserLanguage, translate, supportedLanguages, getLocalizedCommands } = require('./localization');





let currentModel = OPENAI_API_KEY ? DEFAULT_MODEL : null;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
  webhook: {
    port: process.env.PORT
  }
});

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

let businessConnections = {};

bot.on('business_message', async (ctx) => {
  try {
    const bizcon = await ctx.getBusinessConnection();
    const businessConnectionId = ctx.businessMessage.business_connection_id;
    
    if (businessConnectionId) {
      businessConnections[ctx.businessMessage.chat.id] = businessConnectionId;
      console.log('Stored Business Connection ID:', businessConnectionId);
    }
  } catch (error) {
    console.error(error);
  }
});


function getMessageFromUpdate(update) {
  if (update.callback_query) {
    return update.callback_query.message;
  }
  return update.message || update.edited_message;
}

async function sendMessageWithFallback(chatId, text, parseMode = 'Markdown') {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: parseMode });
  } catch (error) {
    console.error('Error sending message with Markdown:', error);
    try {
      // 移除 Markdown 语法
      const plainText = text.replace(/[*_`\[\]()~>#+=|{}.!-]/g, '');
      await bot.sendMessage(chatId, plainText);
    } catch (secondError) {
      console.error('Error sending plain text message:', secondError);
      throw new Error('Failed to send message in any format');
    }
  }
}

async function updateBotCommands(userId) {
  const commands = await getLocalizedCommands(userId);
  try {
    await bot.setMyCommands(commands, { scope: { type: 'chat', chat_id: userId } });
    console.log(`Updated bot commands for user ${userId}`);
  } catch (error) {
    console.error(`Failed to update bot commands for user ${userId}:`, error);
  }
}



let businessConnections = {};  // Store business connection IDs

async function handleStart(msg) {
  const senderbusinessbot = msg.sender_business_bot = true;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  const businessConnectionId = msg.business_connection_id;

  if (businessConnectionId) {
    businessConnections[chatId] = businessConnectionId;  // Save the business connection ID
    console.log('Stored Business Connection ID:', businessConnectionId);
  }

  try {
    await bot.sendMessage(chatId, translate('welcome', userLang, {model: currentModel}), { 
      parse_mode: 'Markdown',
      sender_business_bot: senderbusinessbot,
      business_connection_id: businessConnectionId || ''  // Include the business connection ID if available
    });
    console.log('Start message sent successfully');
  } catch (error) {
    console.error('Error sending start message:', error);
  }
}
}

async function handleNew(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  try {
    await clearConversationHistory(userId);
    await bot.sendMessage(chatId, translate('new_conversation', userLang, {model: currentModel}), {parse_mode: 'Markdown'});
    console.log('New conversation message sent successfully');
  } catch (error) {
    console.error('Error handling new conversation:', error);
  }
}

async function handleHistory(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  try {
    const summarizedHistory = await getSummarizedConversationHistory(userId, currentModel);
    if (!summarizedHistory) {
      await bot.sendMessage(chatId, translate('no_history', userLang), {parse_mode: 'Markdown'});
      return;
    }
    await bot.sendMessage(chatId, translate('history_intro', userLang) + summarizedHistory, {parse_mode: 'Markdown'});
  } catch (error) {
    console.error('Error retrieving summarized conversation history:', error);
    await bot.sendMessage(chatId, translate('error_message', userLang), {parse_mode: 'Markdown'});
  }
}

async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  try {
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
    await bot.sendMessage(chatId, helpMessage, {parse_mode: 'Markdown'});
    console.log('Help message sent successfully');
  } catch (error) {
    console.error('Error sending help message:', error);
  }
}

async function handleSwitchModel(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  const args = msg.text.split(' ');
  
  const availableModels = [
    ...(OPENAI_API_KEY ? OPENAI_MODELS : []),
    ...(GEMINI_API_KEY ? GOOGLE_MODELS : []),
    ...(GROQ_API_KEY ? GROQ_MODELS : []),
    ...(CLAUDE_API_KEY ? CLAUDE_MODELS : []),
    ...(AZURE_OPENAI_API_KEY ? AZURE_OPENAI_MODELS : [])
  ];

  if (args.length < 2) {
    await bot.sendMessage(chatId, translate('forgot_model_name', userLang, {available_models: availableModels.join(', ')}), {parse_mode: 'Markdown'});
    return;
  }

  const modelName = args[1].trim();
  
  if ((OPENAI_MODELS.includes(modelName) && OPENAI_API_KEY) || 
      (GOOGLE_MODELS.includes(modelName) && GEMINI_API_KEY) ||
      (GROQ_MODELS.includes(modelName) && GROQ_API_KEY) ||
      (CLAUDE_MODELS.includes(modelName) && CLAUDE_API_KEY) ||
      (AZURE_OPENAI_MODELS.includes(modelName) && AZURE_OPENAI_API_KEY)) {
    currentModel = modelName;
    await clearConversationHistory(userId);
    await bot.sendMessage(chatId, translate('model_switched', userLang, {model: modelName}), {parse_mode: 'Markdown'});
  } else {
    await bot.sendMessage(chatId, translate('invalid_model', userLang, {available_models: availableModels.join(', ')}), {parse_mode: 'Markdown'});
  }
}

async function handleImageGeneration(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);

  if (!OPENAI_API_KEY) {
    await bot.sendMessage(chatId, translate('no_api_key', userLang));
    return;
  }

  const args = msg.text.split(' ');
  args.shift(); // Remove "/img" command

  let size = '1024x1024';
  let prompt;

  // Check if the last argument is possibly a size
  const possibleSize = args[args.length - 1];
  if (possibleSize && possibleSize.includes('x')) {
    const [width, height] = possibleSize.split('x').map(Number);
    if (VALID_SIZES.includes(`${width}x${height}`)) {
      size = `${width}x${height}`;
      args.pop(); // Remove size from the argument list
    } else {
      // If size is invalid, send error message and return
      await bot.sendMessage(chatId, translate('invalid_size', userLang, {size: possibleSize, valid_sizes: VALID_SIZES.join(', ')}));
      return;
    }
  }

  prompt = args.join(' ');

  if (prompt.trim() === '') {
    // If no description is provided, suggest using /help command
    await bot.sendMessage(chatId, translate('no_image_description', userLang) + ' ' + translate('use_help_command', userLang));
    return;
  }

  try {
    console.log(`Processing image generation request. Chat ID: ${chatId}, Prompt: "${prompt}", Size: ${size}`);
    await bot.sendChatAction(chatId, 'upload_photo');
    
    const requestId = `img_req:${userId}:${Date.now()}`;
    
    const existingImageUrl = await redis.get(requestId);
    
    if (existingImageUrl) {
      console.log(`Using existing image URL: ${existingImageUrl}`);
      await bot.sendPhoto(chatId, existingImageUrl, { caption: prompt });
      return;
    }
    
    console.log(`Generating image with prompt: "${prompt}" and size: ${size}`);
    const imageUrl = await generateImage(prompt, size);
    console.log(`Image URL generated: ${imageUrl}`);
    
    if (imageUrl) {
      await redis.set(requestId, imageUrl, { ex: 86400 }); // Expires after 1 day
      
      console.log(`Sending image. URL: ${imageUrl}`);
      await bot.sendPhoto(chatId, imageUrl, { caption: prompt });
      console.log('Photo sent successfully');
    } else {
      throw new Error('Failed to get image URL');
    }
  } catch (error) {
    console.error('Error in image generation or sending:', error);
    let errorMessage = translate('error_message', userLang);
    if (error.response) {
      console.error('API error response:', error.response.data);
      errorMessage += ` API Error: ${error.response.data.error.message}`;
    } else if (error.request) {
      console.error('No response received from API');
      errorMessage += ' No response received from API.';
    } else {
      errorMessage += ` ${error.message}`;
    }
    await bot.sendMessage(chatId, errorMessage);
  }
}

async function handleStreamMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);
  
  await bot.sendChatAction(chatId, 'typing');
  const conversationHistory = await getConversationHistory(userId);

  const MESSAGE_LENGTH_THRESHOLD = 4000;

  async function sendLongMessage(text) {
    let remainingText = text;
    while (remainingText.length > 0) {
      const chunk = remainingText.slice(0, MESSAGE_LENGTH_THRESHOLD);
      await sendMessageWithFallback(chatId, chunk);
      remainingText = remainingText.slice(MESSAGE_LENGTH_THRESHOLD);
    }
  }

  if (GROQ_MODELS.includes(currentModel) && GROQ_API_KEY) {
    try {
      const response = await generateGroqResponse(msg.text, conversationHistory, currentModel);
      await sendLongMessage(response);
      await addToConversationHistory(userId, msg.text, response);
    } catch (error) {
      console.error('Error in Groq processing:', error);
      await sendMessageWithFallback(chatId, translate('error_message', userLang));
    }
    return;
  }
  
  if (GOOGLE_MODELS.includes(currentModel) && GEMINI_API_KEY) {
    try {
      const response = await generateGeminiResponse(msg.text, conversationHistory, currentModel);
      await sendLongMessage(response);
      await addToConversationHistory(userId, msg.text, response);
    } catch (error) {
      console.error('Error in Gemini processing:', error);
      await sendMessageWithFallback(chatId, translate('error_message', userLang));
    }
    return;
  }

  let stream;
  if (OPENAI_API_KEY && OPENAI_MODELS.includes(currentModel)) {
    stream = generateStreamResponse(msg.text, conversationHistory, currentModel);
  } else if (CLAUDE_API_KEY && CLAUDE_MODELS.includes(currentModel)) {
    stream = generateClaudeResponse(msg.text, conversationHistory, currentModel);
  } else if (AZURE_OPENAI_API_KEY && AZURE_OPENAI_MODELS.includes(currentModel)) {
    stream = generateAzureOpenAIResponse(msg.text, conversationHistory, currentModel);
  } else {
    await bot.sendMessage(chatId, translate('no_api_key', userLang));
    return;
  }

  let fullResponse = '';
  let messageSent = false;
  let messageId;
  let lastUpdateLength = 0;
  
  try {
    for await (const chunk of stream) {
      fullResponse += chunk;

      if (fullResponse.length > MESSAGE_LENGTH_THRESHOLD) {
        if (messageSent) {
          // 发送新消息并重置
          await bot.sendMessage(chatId, fullResponse, {parse_mode: 'Markdown'});
        } else {
          // 首次发送消息
          const sentMsg = await bot.sendMessage(chatId, fullResponse, {parse_mode: 'Markdown'});
          messageId = sentMsg.message_id;
          messageSent = true;
        }
        fullResponse = '';
        lastUpdateLength = 0;
      } else if (fullResponse.length > 0 && !messageSent) {
        // 首次发送消息（短于阈值）
        const sentMsg = await bot.sendMessage(chatId, fullResponse, {parse_mode: 'Markdown'});
        messageId = sentMsg.message_id;
        messageSent = true;
        lastUpdateLength = fullResponse.length;
      } else if (messageSent && fullResponse.length % Math.max(20, Math.floor((fullResponse.length - lastUpdateLength) / 10)) === 0) {
        // 更新现有消息
        try {
          await bot.editMessageText(fullResponse, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          });
          lastUpdateLength = fullResponse.length;
        } catch (error) {
          if (!error.response || error.response.description !== 'Bad Request: message is not modified') {
            console.error('Error editing message:', error);
          }
        }
      }
    }

    // 发送剩余的内容（如果有）
    if (fullResponse.length > 0) {
      if (messageSent) {
        await bot.sendMessage(chatId, fullResponse, {parse_mode: 'Markdown'});
      } else {
        await bot.editMessageText(fullResponse, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        });
      }
    }
  
    await addToConversationHistory(userId, msg.text, fullResponse);
  } catch (error) {
    console.error('Error in stream processing:', error);
    await bot.sendMessage(chatId, translate('error_message', userLang), {parse_mode: 'Markdown'});
  }
}

async function handleImageAnalysis(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userLang = await getUserLanguage(userId);

  if (!OPENAI_API_KEY) {
    await bot.sendMessage(chatId, translate('no_api_key', userLang));
    return;
  }

  // Check if a photo is attached
  const photo = msg.photo && msg.photo[msg.photo.length - 1];
  if (!photo) {
    await bot.sendMessage(chatId, translate('no_image', userLang));
    return;
  }

  // Get the prompt from the caption or wait for it
  let prompt = msg.caption;
  if (!prompt) {
    await bot.sendMessage(chatId, translate('provide_image_description', userLang));
    // Wait for the next message to be the prompt
    const promptMsg = await new Promise(resolve => bot.once('message', resolve));
    prompt = promptMsg.text;
  }

  await bot.sendMessage(chatId, translate('processing_image', userLang));

  try {
    const fileInfo = await bot.getFile(photo.file_id);
    const result = await handleImageUpload(fileInfo, prompt, currentModel);
    await bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in image analysis:', error);
    await bot.sendMessage(chatId, translate('error_message', userLang));
  }
}

async function handleLanguageChange(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const currentLang = await getUserLanguage(userId);
  
  const keyboard = supportedLanguages.map(lang => [{text: translate(lang, currentLang), callback_data: `lang_${lang}`}]);
  
  await bot.sendMessage(chatId, translate('choose_language', currentLang), {
    reply_markup: JSON.stringify({
      inline_keyboard: keyboard
    })
  });
}

async function handleMessage(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const msg = getMessageFromUpdate(update);
  if (!msg) {
    console.log('Update does not contain a valid message');
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    if (!WHITELISTED_USERS.includes(userId)) {
      await bot.sendMessage(chatId, 'Sorry, you are not authorized to use this bot.', {parse_mode: 'Markdown'});
      return;
    }

    const userLang = await getUserLanguage(userId);

    if (msg.photo) {
      await handleImageAnalysis(msg);
    } else if (msg.text) {
      if (msg.text === '/start') {
        await handleStart(msg);
      } else if (msg.text === '/new') {
        await handleNew(msg);
      } else if (msg.text === '/history') {
        await handleHistory(msg);
      } else if (msg.text === '/help') {
        await handleHelp(msg);
      } else if (msg.text.startsWith('/switchmodel')) {
        await handleSwitchModel(msg);
      } else if (msg.text.startsWith('/img')) {
        await handleImageGeneration(msg);
      } else if (msg.text === '/language') {
        await handleLanguageChange(msg);
      } else {
        await handleStreamMessage(msg);
      }
    } else {
      console.log('Received unsupported message type');
      await bot.sendMessage(chatId, translate('unsupported_message', userLang), {parse_mode: 'Markdown'});
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
    await bot.sendMessage(chatId, translate('error_message', userLang), {parse_mode: 'Markdown'});
  }
}

async function handleCallbackQuery(callbackQuery) {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  
  if (action.startsWith('lang_')) {
    const newLang = action.split('_')[1];
    if (await setUserLanguage(userId, newLang)) {
      const userLang = await getUserLanguage(userId);
      await updateBotCommands(userId);
      await bot.answerCallbackQuery(callbackQuery.id, {text: translate('language_set', userLang)});
      await bot.sendMessage(msg.chat.id, translate('language_changed', userLang));
    }
  }
}

module.exports = { 
  bot, 
  handleMessage, 
  handleStart, 
  getMessageFromUpdate, 
  handleCallbackQuery,
  updateBotCommands
};
