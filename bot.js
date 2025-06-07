import { Client, GatewayIntentBits } from 'discord.js';

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';
import { languageFlagMap } from './flags.js';

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.DirectMessages
	],
	partials: ['CHANNEL']
});
dotenv.config()

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const USER_ID = process.env.DISCORD_USER_ID;



const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// Wrap rl.question in a Promise
function ask(question) {
	return new Promise(resolve => rl.question(question, resolve));
}

const { data: languages } = await axios.get('https://api-free.deepl.com/v2/languages', {
	headers: {
		'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`
	},
	params: {
		type: 'target'
	}
});

// Display language list
languages.forEach((lang, i) => {
	console.log(`${i + 1}: ${lang.name} - ${lang.language}`);
});

let user_ready = false;
let chosen_language = null;

while (!user_ready) {
	const choice = await ask("Pick a language by entering its number: ");

	const index = parseInt(choice, 10);
	if (isNaN(index) || index < 1 || index > languages.length) {
		console.log("❌ Invalid input. Please enter a valid number from the list.");
		continue;
	}

	chosen_language = languages[index - 1];
	const confirm = await ask(`You chose "${chosen_language.name}". Is that correct? (Y/n): `);

	if (confirm.trim().toLowerCase() === 'n') {
		continue;
	}

	user_ready = true;
}

console.log(`✅ Final choice: ${chosen_language.name} (${chosen_language.language})`);

rl.close();



const USAGE_FILE = path.join('./usage.json');
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

async function translate(text, formality_aval = true) {
	const response = await axios.post('https://api-free.deepl.com/v2/translate', null, {
		params: {
			auth_key: DEEPL_API_KEY,
			text,
			// target_lang: 'FR',
			target_lang: chosen_language.language,
			show_billed_characters: true,
			// ...(formality_aval ? { formality: 'less' } : {})
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
		await user.send(`📝 Original: ${cleanText}\n${languageFlagMap[chosen_language.language]} ${chosen_language.name}: ${translation}`);
		console.log(`✅ Translated ${billedChars} chars. Total today: ${usage.charsUsed}/${dailyLimit}`);
	} catch (err) {
		console.log('⚠️ Error translating:', err.response?.data || err.message);
	}
});

client.login(DISCORD_TOKEN);
