const schedule = require('node-schedule');
const db = require('./database');

class Scheduler {
    constructor() {
        this.jobs = new Map();
    }

    init(bot) {
        // Проверка каждую минуту на приближающиеся задачи
        schedule.scheduleJob('* * * * *', async () => {
            await this.checkUpcomingTasks(bot);
        });

        // Еженедельная рассылка по понедельникам в 9:00
        schedule.scheduleJob('0 9 * * 1', async () => {
            await this.sendWeeklyDigest(bot);
        });
    }

    async checkUpcomingTasks(bot) {
        const tasks = await db.getUpcomingTasks();
        
        for (const task of tasks) {
            const now = new Date();
            const taskTime = new Date(task.date);
            const diffMinutes = (taskTime - now) / 60000;

            let notified = false;
            // Напоминание за 15 минут
            if (diffMinutes <= 15 && diffMinutes > 0) {
                const message = `⏰ Напоминание: через ${Math.round(diffMinutes)} минут\n${task.text}`;
                // Для общих задач отправляем в чат создания (упрощённо)
                await bot.sendMessage(task.chatId, message);
                notified = true;
            }
            // Напоминание о наступившем событии (в течение 5 минут после начала)
            if (diffMinutes <= 0 && diffMinutes > -5) {
                const message = `🔔 Событие началось!\n${task.text}`;
                await bot.sendMessage(task.userId.toString(), message);
                notified = true;
            }
            // Если отправили напоминание, помечаем задачу как уведомленную
            if (notified) {
                task.notified = true;
                await db.save();
            }
        }
    }

    async sendWeeklyDigest(bot) {
        // Получаем всех пользователей из файлового хранилища
        const users = db.users; // массив пользователей
        if (!users || users.length === 0) return;

        for (const user of users) {
            const tasks = await db.getWeekTasks(user.userId);
            
            if (tasks.length > 0) {
                let message = '📅 Задачи на неделю:\n\n';
                tasks.forEach((task, index) => {
                    const date = new Date(task.date).toLocaleDateString('ru-RU', {
                        weekday: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    message += `${index + 1}. ${task.text}\n   📆 ${date}\n\n`;
                });
                
                await bot.sendMessage(user.userId, message);
            }
        }
    }
}

module.exports = new Scheduler();