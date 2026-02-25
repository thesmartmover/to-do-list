const fs = require('fs').promises;
const path = require('path');

class Database {
    constructor() {
        this.dataFile = path.join(__dirname, '../data.json');
        this.tasks = [];
        this.users = [];
    }

    async connect() {
        try {
            // Пытаемся загрузить существующие данные
            const data = await fs.readFile(this.dataFile, 'utf8');
            const parsed = JSON.parse(data);
            this.tasks = parsed.tasks || [];
            this.users = parsed.users || [];
            console.log('✅ Данные загружены из data.json');
        } catch (error) {
            // Если файла нет, создаем пустую структуру
            await this.save();
            console.log('📁 Создан новый файл data.json');
        }
    }

    async save() {
        const data = {
            tasks: this.tasks,
            users: this.users
        };
        await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
    }

    async addTask(taskData) {
        const task = {
            _id: Date.now().toString(),
            ...taskData,
            createdAt: new Date(),
            completed: false,
            notified: false
        };
        this.tasks.push(task);
        await this.save();
        return task;
    }

    async getUserTasks(userId) {
        return this.tasks.filter(task => 
            (task.userId === userId || task.isGeneral) && !task.completed
        );
    }

    async getUpcomingTasks(minutes = 15) {
        const now = new Date();
        const later = new Date(now.getTime() + minutes * 60000);
        
        return this.tasks.filter(task => 
            new Date(task.date) >= now && 
            new Date(task.date) <= later && 
            !task.notified && 
            !task.completed
        );
    }

    async postponeTask(taskId, newDate) {
        const task = this.tasks.find(t => t._id === taskId);
        if (task) {
            task.date = newDate;
            task.notified = false;
            await this.save();
            return true;
        }
        return false;
    }

    async getWeekTasks(userId) {
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        return this.tasks.filter(task =>
            (task.userId === userId || task.isGeneral) &&
            !task.completed &&
            new Date(task.date) >= now &&
            new Date(task.date) <= nextWeek
        ).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    async addUser(userId, chatId) {
        if (!this.users.find(u => u.userId === userId)) {
            this.users.push({ userId, chatId, createdAt: new Date() });
            await this.save();
        }
    }

    async addUser(userId, chatId, userInfo = {}) {
    const existingUser = this.users.find(u => u.userId === userId);
    
    if (!existingUser) {
        const user = {
            userId,
            chatId,
            username: userInfo.username,
            firstName: userInfo.first_name,
            lastName: userInfo.last_name,
            createdAt: new Date(),
            lastActivity: new Date()
        };
        this.users.push(user);
        await this.save();
        console.log(`✅ Новый пользователь: @${userInfo.username || userId}`);
    } else {
        // Обновляем последнюю активность
        existingUser.lastActivity = new Date();
        existingUser.chatId = chatId; // Обновляем chatId на всякий случай
        await this.save();
    }
}

}

module.exports = new Database();
