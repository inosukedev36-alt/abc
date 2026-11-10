// lib/gf-sleep.js — Sleep validation + greetings with TimeZone

function parseTime(str) {
  const m = String(str).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// දැන් තියෙන වෙලාව ශ්‍රී ලංකා වෙලාවෙන් ගන්න helper function එක
function getCurrentTimeInMinutes() {
  const now = new Date();
  const options = { timeZone: 'Asia/Colombo', hour: 'numeric', minute: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  
  let hours = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);
  
  // සමහර වෙලාවට 24:00 කියලා එන්න පුළුවන්, ඒක 0 කරමු
  if (hours === 24) hours = 0;
  
  return hours * 60 + minutes;
}

function validateSleep(wakeStr, sleepStr) {
  const wake = parseTime(wakeStr);
  const sleep = parseTime(sleepStr);
  if (wake === null || sleep === null) {
    return { valid: false, reason: 'invalid_format' };
  }
  let duration = wake - sleep;
  if (duration <= 0) duration += 24 * 60;
  const hours = duration / 60;
  if (hours !== 5) {
    return { valid: false, reason: 'not_5_hours', hours };
  }
  return { valid: true, hours: 5 };
}

function isSleeping(wakeStr, sleepStr) {
  const wake = parseTime(wakeStr);
  const sleep = parseTime(sleepStr);
  if (wake === null || sleep === null) return false;
  
  const current = getCurrentTimeInMinutes(); // දැන් තියෙන SL වෙලාව

  if (sleep < wake) {
    return current >= sleep && current < wake;
  } else {
    return current >= sleep || current < wake;
  }
}

function isWakeTime(wakeStr, toleranceMin = 5) {
  const wake = parseTime(wakeStr);
  if (wake === null) return false;
  
  const current = getCurrentTimeInMinutes(); // දැන් තියෙන SL වෙලාව
  const diff = Math.abs(current - wake);
  return diff <= toleranceMin || (60 * 24 - diff) <= toleranceMin;
}

function getMorningGreeting(gfName, userName) {
  const name = userName || 'ඔයා';
  return `☀️ සුබ උදෑසනක් ${name}!\nමම ඇහැරුණා. ඔයා කොහොමද?`;
}

function getSleepMessage(gfName) {
  return `මට නිදිමතයි... මම නිදාගන්න යනවා. උදේ කතා කරමු 🖤`;
}

module.exports = {
  parseTime, validateSleep, isSleeping, isWakeTime,
  getMorningGreeting, getSleepMessage,
};