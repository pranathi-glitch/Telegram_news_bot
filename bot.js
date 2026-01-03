require('dotenv').config();
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const axios = require('axios');

// Firebase setup
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const bot = new Telegraf(process.env.BOT_TOKEN);
const userId = (ctx) => ctx.from.id.toString();

// /debug - Check API keys (admin only)
bot.command('debug', async (ctx) => {
  if (ctx.from.id !== 123456789) return; // Replace with YOUR Telegram user ID
  ctx.reply(`BOT_TOKEN: ${process.env.BOT_TOKEN ? '✅ Set' : '❌ Missing'}\nNEWS_API_KEY: ${process.env.NEWS_API_KEY ? '✅ Set' : '❌ Missing'}`);
});

// /news - NewsAPI + Weather fallback
bot.command('news', async (ctx) => {
  try {
    const uid = userId(ctx);
    
    // Try NewsAPI first
    const newsResponse = await axios.get(`https://newsapi.org/v2/top-headlines?country=us&apiKey=${process.env.NEWS_API_KEY}`, {
      timeout: 5000
    });
    const newsData = newsResponse.data;
    
    console.log('NewsAPI response:', newsData.status, newsData.totalResults); // Terminal debug
    
    if (newsData.articles && newsData.articles.length > 0) {
      const article = newsData.articles[0];
      const message = `📰 *${article.title}*\n\n${article.description || 'No description'}\n\n${article.url}`;
      
      await db.collection('users').doc(uid).update({
        totalRequests: admin.firestore.FieldValue.increment(1)
      });
      
      await db.collection('news_logs').add({
        userId: uid,
        title: article.title,
        url: article.url,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return ctx.reply(message, { parse_mode: 'Markdown' });
    }
  } catch (newsError) {
    console.error('NewsAPI failed:', newsError.response?.status, newsError.message);
  }
  // Fallback: Free OpenWeatherMap (no key needed for basic)
  try {
    ctx.reply('📰 News unavailable, showing Delhi weather instead...');
    const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.23&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch');
    const weather = weatherResponse.data.current_weather;
    
    await db.collection('users').doc(userId(ctx)).update({
      totalRequests: admin.firestore.FieldValue.increment(1)
    });
    
    ctx.reply(`🌤️ *Delhi Weather*\n🌡️ ${weather.temperature}°F\n💨 ${weather.windspeed} mph\n${weather.weathercode === 0 ? '☀️ Clear' : '🌥️ Cloudy'}`, { parse_mode: 'Markdown' });
  } catch (weatherError) {
    ctx.reply('❌ Both services down. Try /mydata!');
    console.error('Weather fallback failed:', weatherError.message);
  }
});

// Keep other commands same...
bot.start(async (ctx) => {
  const uid = userId(ctx);
  await db.collection('users').doc(uid).set({
    firstName: ctx.from.first_name,
    totalRequests: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  ctx.reply('📰 Welcome! Use:\n/news - Latest news/weather\n/mydata - Your stats\n/clear - Reset data\n/debug - Check setup (you only)');
});

bot.command('mydata', async (ctx) => {
  const uid = userId(ctx);
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const data = userDoc.data();
    ctx.reply(`👤 *${data.firstName}*\n📊 Requests: ${data.totalRequests || 0}\n📅 Joined: ${data.createdAt?.toDate()?.toLocaleDateString('en-IN') || 'N/A'}`, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('❌ No data found. Send /start first!');
  }
});

bot.command('clear', async (ctx) => {
  const uid = userId(ctx);
  await db.collection('users').doc(uid).delete();
  const logs = await db.collection('news_logs').where('userId', '==', uid).get();
  logs.docs.forEach(doc => doc.ref.delete());
  ctx.reply('🗑️ All your data cleared!');
});

bot.launch();
console.log('📰 News bot running! Test: /start then /news');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
