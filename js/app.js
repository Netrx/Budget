// ===== ГЛАВНЫЙ ФАЙЛ ПРИЛОЖЕНИЯ =====
import { routes } from './config/routes.js';
import { Storage } from './data/storage.js';
import { showToast } from './components/toast.js';

class App {
    constructor() {
        this.currentTab = 'dashboard';
        this.storage = new Storage();
        this.init();
    }

    async init() {
        await this.loadTab('dashboard');
        this.setupNavigation();
        this.loadSidebar();
        this.loadHeader();
        this.applyTheme();
    }

    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                if (tab && tab !== this.currentTab) {
                    this.loadTab(tab);
                }
            });
        });
    }

    async loadTab(tabName) {
        if (!routes[tabName]) {
            showToast('Вкладка не найдена', 'error');
            return;
        }

        this.currentTab = tabName;
        
        try {
            const module = await import(`./modules/${tabName}.js`);
            const content = document.getElementById('content');

            const response = await fetch(`templates/${tabName}.html`);

            if (!response.ok) {
                throw new Error(`Шаблон ${tabName}.html не найден (${response.status})`);
            }

            const templateHTML = await response.text();
            content.innerHTML = templateHTML;

            if (module.init) {
                module.init(this.storage);
            }

            this.activateNavItem(tabName);

        } catch (error) {
            console.error(`Ошибка загрузки модуля ${tabName}:`, error);
            showToast(`Ошибка: ${error.message}`, 'error');
        }
    }

    activateNavItem(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });
    }

    loadSidebar() {
        const sidebar = document.getElementById('sidebar');

        const navItems = Object.entries(routes).map(([key, route]) => `
            <button class="nav-item ${key === 'dashboard' ? 'active' : ''}" data-tab="${key}">
                <span class="icon">${route.icon}</span>
                <span class="label">${route.title}</span>
            </button>
        `).join('');

        sidebar.innerHTML = `
            <nav class="sidebar-nav">
                ${navItems}
            </nav>
        `;

        this.setupNavigation();
    }

    loadHeader() {
        const header = document.getElementById('header');
        const balance = this.storage.getBalance();

        header.innerHTML = `
            <div class="header-content">
                <div class="header-left">
                    <span class="logo">Бюджет</span>
                </div>
                <div class="header-right">
                    <div class="balance-display">
                        <span>Баланс</span>
                        <span class="amount">${balance.toFixed(2)} ₽</span>
                    </div>
                </div>
            </div>
        `;
    }

    toggleTheme() {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        this.storage.updateSettings({ theme: next });
        showToast(`${next === 'dark' ? 'Темная' : 'Светлая'} тема`, 'success');

        document.dispatchEvent(new Event('theme-changed'));
    }

    applyTheme() {
        const settings = this.storage.getSettings();
        const theme = settings.theme || 'light';
        document.documentElement.setAttribute('data-theme', theme);
    }

    refreshHeader() {
        this.loadHeader();
    }
}

const app = new App();
window.app = app;