const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const USER_ID = process.env.DISCORD_USER_ID;

const USAGE_FILE = path.join(__dirname, 'usage.json');
const MONTHLY_LIMIT = 500_000;

// Remove Discord custom emojis like <a:name:id> or <:name:id>
const discordEmojiRegex = /<a?:\w+:\d+>/g;

// Remove Unicode emoji
const unicodeEmojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;

function stripEmojis(text) {
  return text.replace(discordEmojiRegex, '').replace(unicodeEmojiRegex, '');
}

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

function getDailyLimit() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  return Math.floor(MONTHLY_LIMIT / daysInMonth);
}

function loadUsage() {
  if (!fs.existsSync(USAGE_FILE)) {
    return { date: getTodayDateString(), charsUsed: 0 };
  }
  const data = fs.readFileSync(USAGE_FILE, 'utf8');
  return JSON.parse(data);
}

function saveUsage(usage) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

function resetIfNewDay(usage) {
  const today = getTodayDateString();
  if (usage.date !== today) {
    usage.date = today;
    usage.charsUsed = 0;
  }
  return usage;
}

async function translate(text) {
  const response = await axios.post('https://api-free.deepl.com/v2/translate', null, {
    params: {
      auth_key: DEEPL_API_KEY,
      text,
      target_lang: 'FR',
      show_billed_characters: true,
      formality: 'less'
    }
  });

  const translation = response.data.translations[0].text;
  const billedChars = response.data.character_count ?? text.length;
  return { translation, billedChars };
}

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== USER_ID) return;

  let usage = resetIfNewDay(loadUsage());
  const dailyLimit = getDailyLimit();

  const rawText = message.content;
  const cleanText = stripEmojis(rawText);

  if (cleanText.trim().length < 1) return;

  if (usage.charsUsed >= dailyLimit) {
    console.log('❌ Daily character limit reached.');
    return;
  }

  try {
    const { translation, billedChars } = await translate(cleanText);

    if (usage.charsUsed + billedChars > dailyLimit) {
      console.log(`❌ Would exceed daily limit: ${usage.charsUsed + billedChars} > ${dailyLimit}`);
      return;
    }

    usage.charsUsed += billedChars;
    saveUsage(usage);

    const user = await client.users.fetch(USER_ID);
    await user.send(`📝 Original: ${cleanText}\n🇫🇷 French: ${translation}`);
    console.log(`✅ Translated ${billedChars} chars. Total today: ${usage.charsUsed}/${dailyLimit}`);
  } catch (err) {
    console.error('⚠️ Error translating:', err.response?.data || err.message);
  }
});

client.login(DISCORD_TOKEN);
