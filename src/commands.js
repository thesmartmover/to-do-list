const db = require('./database');

class Commands {
    static async handleStart(botInstance, msg) {
        const chatId = msg.chat.id;
        const userName = msg.from.first_name || 'пользователь';
        
        const welcomeMessage = `
👋 Привет, ${userName}! Я бот-планировщик задач.

📋 **Доступные команды:**
• /addtask - Добавить новую задачу
• /mytasks - Мои задачи на сегодня
• /week - Задачи на неделю
• /postpone [номер] [дата] - Отложить задачу
• /help - Подробная помощь

💡 **Как пользоваться:**
1. Нажмите /addtask
2. Введите описание задачи
3. Укажите дату и время
4. Готово! Я напомню

Для общих задач добавьте #общее в описание!
        `;
        
        await botInstance.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        
        // Добавляем reply-клавиатуру
        const keyboard = {
            reply_markup: {
                keyboard: [
                    [{ text: '➕ Добавить задачу' }],
                    [{ text: '📋 Мои задачи' }, { text: '📅 Неделя' }],
                    [{ text: '❓ Помощь' }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };
        await botInstance.bot.sendMessage(chatId, 'Выберите действие:', keyboard);

        // Сохраняем пользователя
        try {
            await db.addUser(msg.from.id, chatId, msg.from);
        } catch (error) {
            console.error('Ошибка сохранения пользователя:', error);
        }
    }

    static async handleHelp(botInstance, msg) {
        const chatId = msg.chat.id;
        const helpText = `
📚 **Подробная инструкция:**

**Добавление задачи:**
1. /addtask - начать создание
2. Введите описание
3. Укажите дату в одном из форматов:
   • "2024-12-31 23:59" - точная дата
   • "завтра 15:30" - завтра в 15:30
   • "через 2 часа" - через 2 часа
   • "в пятницу 18:00" - в ближайшую пятницу

**Общие задачи:**
Добавьте #общее в описание, и о задаче узнают все

**Просмотр задач:**
• /mytasks - задачи на сегодня
• /week - все задачи на неделю

**Управление:**
• /postpone 1 завтра - отложить задачу №1 на завтра
        `;
        
        await botInstance.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }

    static async handleAddTask(botInstance, msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        botInstance.userStates.set(`${userId}_${chatId}`, {
            waitingFor: 'taskText'
        });
        
        await botInstance.bot.sendMessage(chatId, 
            '📝 Введите описание задачи:\n' +
            '(например: "Купить продукты" или "#общее Собрание в 15:00")'
        );
    }

    static async handleMyTasks(botInstance, msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        try {
            const tasks = await db.getUserTasks(userId);
            
            if (!tasks || tasks.length === 0) {
                await botInstance.bot.sendMessage(chatId, '✅ У вас нет активных задач!');
                return;
            }
            
            // Фильтруем задачи на сегодня
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const todayTasks = tasks.filter(task => {
                const taskDate = new Date(task.date);
                return taskDate >= today && taskDate < tomorrow;
            });
            
            if (todayTasks.length === 0) {
                await botInstance.bot.sendMessage(chatId, '📅 На сегодня задач нет!');
                return;
            }
            await botInstance.bot.sendMessage(chatId, '📋 Ваши задачи на сегодня:');
            for (const task of todayTasks) {
                const taskDate = new Date(task.date);
                const timeStr = taskDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const taskMsg = `📌 ${task.text}\n⏰ ${timeStr}`;
                const inlineKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Выполнено', callback_data: `task_done_${task._id}` },
                             { text: '⏳ Отложить', callback_data: `task_postpone_${task._id}` }  
                            ]
                        ]
                    }
                };
                await botInstance.bot.sendMessage(chatId, taskMsg, inlineKeyboard);
            }
                     
        } catch (error) {
            console.error('Ошибка при получении задач:', error);
            await botInstance.bot.sendMessage(chatId, '❌ Ошибка при получении задач');
        }
    }

    static async handleWeekTasks(botInstance, msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        try {
            const tasks = await db.getWeekTasks(userId);
            
            if (!tasks || tasks.length === 0) {
                await botInstance.bot.sendMessage(chatId, '📅 На неделю нет запланированных задач!');
                return;
            }
            
            let message = '📅 **Задачи на неделю:**\n\n';
            const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
            
            tasks.forEach(task => {
                const date = new Date(task.date);
                const dayName = days[date.getDay()];
                const time = date.toLocaleTimeString('ru-RU', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                const type = task.isGeneral ? '👥' : '👤';
                message += `${type} ${dayName} ${time} - ${task.text}\n`;
            });
            
            await botInstance.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Ошибка при получении задач на неделю:', error);
            await botInstance.bot.sendMessage(chatId, '❌ Ошибка при получении задач');
        }
    }

    static async handlePostpone(botInstance, msg, match) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        if (!match || !match[1]) {
            await botInstance.bot.sendMessage(chatId, 
                '❌ Использование: /postpone [номер задачи] [новая дата]\n' +
                'Пример: /postpone 1 завтра 15:00'
            );
            return;
        }
        
        // Здесь будет логика откладывания задачи
        await botInstance.bot.sendMessage(chatId, '⏳ Функция откладывания задач в разработке');
    }
}

module.exports = Commands;
