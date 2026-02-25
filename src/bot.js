const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
require('dotenv').config();

const db = require('./database');
const scheduler = require('./scheduler');
const commands = require('./commands');

class TaskBot {
    constructor() {
        this.token = process.env.BOT_TOKEN;
        
        if (!this.token) {
            console.error('❌ Ошибка: BOT_TOKEN не найден в .env файле!');
            console.log('Создайте файл .env с содержимым:');
            console.log('BOT_TOKEN=ваш_токен_от_BotFather');
            console.log('TIMEZONE=Europe/Moscow');
            process.exit(1);
        }

        // Настройки подключения с обработкой ошибок
        this.bot = new TelegramBot(this.token, { 
            polling: {
                interval: 300, // Опрос каждые 300ms
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });

        this.userStates = new Map();
        this.init();
    }

    async init() {
        try {
            // Подключаемся к БД
            await db.connect();

            // Регистрируем обработчики
            this.registerHandlers();

            // Запускаем планировщики
            scheduler.init(this.bot);

            // Получаем информацию о боте
            const botInfo = await this.bot.getMe();
            console.log(`✅ Бот @${botInfo.username} успешно запущен!`);
            console.log(`📅 Ожидаю команды...`);

        } catch (error) {
            console.error('❌ Ошибка при инициализации бота:', error.message);
            this.handleError(error);
        }
    }

    handleError(error) {
        if (error.code === 'ETELEGRAM' && error.response?.statusCode === 401) {
            console.error('❌ Неверный токен бота!');
            console.log('\n💡 Решение:');
            console.log('1. Найдите @BotFather в Telegram');
            console.log('2. Отправьте команду /revoke');
            console.log('3. Выберите этого бота');
            console.log('4. Получите новый токен');
            console.log('5. Обновите BOT_TOKEN в файле .env');
        } else if (error.code === 'EFATAL') {
            console.error('❌ Критическая ошибка подключения к Telegram');
            console.log('\n💡 Проверьте:');
            console.log('1. Стабильность интернет-соединения');
            console.log('2. Не заблокирован ли Telegram в вашей сети');
            console.log('3. Не используется ли прокси/VPN');
        }
    }

    registerHandlers() {
        // Обработка ошибок polling
        this.bot.on('polling_error', (error) => {
            console.error('⚠️ Ошибка опроса:', error.message);
            if (error.code === 'ETELEGRAM' && error.response?.statusCode === 401) {
                console.error('❌ Неверный токен! Бот остановлен.');
                process.exit(1);
            }
        });

        // Команды
        this.bot.onText(/\/start/, (msg) => commands.handleStart(this, msg));
        this.bot.onText(/\/help/, (msg) => commands.handleHelp(this, msg));
        this.bot.onText(/\/addtask/, (msg) => commands.handleAddTask(this, msg));
        this.bot.onText(/\/mytasks/, (msg) => commands.handleMyTasks(this, msg));
        this.bot.onText(/\/week/, (msg) => commands.handleWeekTasks(this, msg));
        this.bot.onText(/\/postpone (.+)/, (msg, match) => commands.handlePostpone(this, msg, match));

        // Обработка всех сообщений
        this.bot.on('message', (msg) => this.handleMessage(msg));

        // Обработка ошибок
        this.bot.on('error', (error) => {
            console.error('⚠️ Ошибка бота:', error.message);
        });
    }

    async handleMessage(msg) {
        // Игнорируем команды (они уже обработаны)
        if (msg.text && msg.text.startsWith('/')) {
            return;
        }

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        const state = this.userStates.get(`${userId}_${chatId}`);

        if (state && state.waitingFor === 'taskText') {
            this.userStates.set(`${userId}_${chatId}`, {
                ...state,
                taskText: text,
                waitingFor: 'taskDate'
            });
            await this.bot.sendMessage(chatId, 
                '📅 Отлично! Теперь укажите дату и время.\n\n' +
                'Примеры:\n' +
                '• 2024-12-31 23:59\n' +
                '• завтра 15:30\n' +
                '• через 2 часа\n' +
                '• в пятницу 18:00\n\n' +
                '(Для общей задачи добавьте #общее)'
            );
            return;
        }

        if (state && state.waitingFor === 'taskDate') {
            try {
                const parsedDate = this.parseDate(text);
                
                if (parsedDate) {
                    const isGeneral = text.toLowerCase().includes('#общее') || 
                                     state.taskText.toLowerCase().includes('#общее');
                    
                    await db.addTask({
                        userId: userId,
                        chatId: chatId,
                        text: state.taskText,
                        date: parsedDate,
                        isGeneral: isGeneral
                    });
                    
                    this.userStates.delete(`${userId}_${chatId}`);
                    
                    const dateStr = parsedDate.toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    await this.bot.sendMessage(chatId, 
                        `✅ Задача добавлена!\n\n` +
                        `📝 ${state.taskText}\n` +
                        `📅 ${dateStr}\n` +
                        `${isGeneral ? '👥 Общее событие' : '👤 Личное'}`
                    );
                } else {
                    await this.bot.sendMessage(chatId, 
                        '❌ Не удалось распознать дату.\n' +
                        'Попробуйте еще раз или отправьте /cancel для отмены.'
                    );
                }
            } catch (error) {
                console.error('Ошибка при создании задачи:', error);
                await this.bot.sendMessage(chatId, 
                    '❌ Произошла ошибка при создании задачи. Попробуйте позже.'
                );
                this.userStates.delete(`${userId}_${chatId}`);
            }
        }
    }

    parseDate(text) {
        const now = new Date();
        
        // Проверяем формат YYYY-MM-DD HH:MM
        const standardMatch = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
        if (standardMatch) {
            const [_, year, month, day, hour, minute] = standardMatch;
            return new Date(year, month - 1, day, hour, minute);
        }
        
        // Проверяем "завтра"
        if (text.toLowerCase().includes('завтра')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                tomorrow.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0);
            } else {
                tomorrow.setHours(10, 0, 0); // По умолчанию 10:00
            }
            return tomorrow;
        }
        
        // Проверяем "через X часов"
        const hoursMatch = text.toLowerCase().match(/через\s+(\d+)\s*час/);
        if (hoursMatch) {
            const hours = parseInt(hoursMatch[1]);
            const date = new Date(now);
            date.setHours(date.getHours() + hours);
            return date;
        }
        
        // Проверяем "через X минут"
        const minutesMatch = text.toLowerCase().match(/через\s+(\d+)\s*мин/);
        if (minutesMatch) {
            const minutes = parseInt(minutesMatch[1]);
            const date = new Date(now);
            date.setMinutes(date.getMinutes() + minutes);
            return date;
        }
        
        return null;
    }
}

// Запуск бота
new TaskBot();
