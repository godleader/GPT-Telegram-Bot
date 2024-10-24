const { Redis } = require('@upstash/redis');
const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, TELEGRAM_BOT_TOKEN } = require('./config');
const TelegramBot = require('node-telegram-bot-api');

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

/**
 * Get the business connection ID for a specific chat.
 * @param {number} chatId - The chat ID for which to get the business connection ID.
 * @returns {Promise<string|null>} - The business connection ID, or null if not available.
 */
async function getBusinessConnectionId(chatId) {
  try {
    // Attempt to retrieve the business connection ID from Redis cache.
    const connectionId = await redis.get(`business_connection:${chatId}`);
    if (connectionId) {
      return connectionId;
    }

    // If no connection ID found, perform necessary logic to fetch it, e.g., from an external API.
    // For the sake of this implementation, we will simulate this with a placeholder.
    const fetchedConnectionId = await fetchBusinessConnectionIdFromAPI(chatId);
    
    if (fetchedConnectionId) {
      // Cache the connection ID in Redis for faster future access.
      await redis.set(`business_connection:${chatId}`, fetchedConnectionId, { ex: 3600 }); // Cache for 1 hour
      return fetchedConnectionId;
    }

    return null;
  } catch (error) {
    console.error('Error fetching business connection ID:', error);
    return null;
  }
}

/**
 * Simulates fetching the business connection ID from an external API or data source.
 * @param {number} chatId - The chat ID for which to fetch the business connection ID.
 * @returns {Promise<string|null>} - A simulated business connection ID, or null if not available.
 */
async function fetchBusinessConnectionIdFromAPI(chatId) {
  // This is a placeholder implementation.
  // Replace with actual logic to interact with your API or database to get the business connection ID.
  console.log(`Fetching business connection ID for chat ID: ${chatId} from external API...`);
  // Simulate a successful fetch with a random connection ID.
  return `connection-${chatId}`;
}

/**
 * Send a business message if a business connection exists, otherwise send a regular message.
 * @param {number} chatId - The chat ID to which the message should be sent.
 * @param {string} text - The text of the message to be sent.
 */
async function sendBusinessMessage(chatId, text) {
  try {
    const connectionId = await getBusinessConnectionId(chatId);
    if (connectionId) {
      // Send message through business connection
      await bot.invokeWithBusinessConnection(connectionId, 'messages.sendMessage', {
        peer: chatId,
        message: text,
        parse_mode: 'Markdown'
      });
      console.log(`Business message sent to chat ID: ${chatId}`);
    } else {
      // Send regular message if no business connection
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      console.log(`Regular message sent to chat ID: ${chatId}`);
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Listen for messages and respond using the business chatbots feature
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;

  // Example response logic
  if (userMessage.toLowerCase() === '/start') {
    await sendBusinessMessage(chatId, 'Welcome to our business chatbot! How can I assist you today?');
  } else {
    await sendBusinessMessage(chatId, `You said: ${userMessage}`);
  }
});

module.exports = {
  getBusinessConnectionId,
  sendBusinessMessage,
};
