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

            if (diffMinutes <= 15 && diffMinutes > 0) {
                // Напоминание за 15 минут
                const message = `⏰ Напоминание: через ${Math.round(diffMinutes)} минут\n${task.text}`;
                
                if (task.isGeneral) {
                    // Отправляем всем пользователям из чата
                    // Здесь нужно реализовать логику отправки всем участникам
                    bot.sendMessage(task.chatId, message);
                } else {
                    bot.sendMessage(task.chatId, message);
                }
            }

            if (diffMinutes <= 0 && diffMinutes > -5) {
                // Напоминание о наступившем событии
                const message = `🔔 Событие началось!\n${task.text}`;
                bot.sendMessage(task.userId.toString(), message);
            }
        }
    }

    async sendWeeklyDigest(bot) {
        // Получаем всех пользователей
        const users = await db.users.find({}).toArray();
        
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
                
                bot.sendMessage(user.userId, message);
            }
        }
    }
}

module.exports = new Scheduler();