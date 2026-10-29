// ===== МОДУЛЬ: НАСТРОЙКИ =====
import { CURRENCIES } from '../config/constants.js';
import { showToast } from '../components/toast.js';

let storageInstance = null;

export function init(storage) {
    storageInstance = storage;
    renderSettings();
    setupEventListeners();
}

function renderSettings() {
    const settings = storageInstance.getSettings();
    
    const currencySelect = document.getElementById('currency');
    if (currencySelect) {
        const currentCurrency = settings.currency || 'RUB';
        currencySelect.innerHTML = Object.entries(CURRENCIES).map(([key, val]) => 
            `<option value="${key}" ${key === currentCurrency ? 'selected' : ''}>${val.symbol} ${val.name}</option>`
        ).join('');
    }
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const currentTheme = settings.theme || 'light';
        themeToggle.checked = currentTheme === 'dark';
    }
}

function setupEventListeners() {
    document.getElementById('currency')?.addEventListener('change', (e) => {
        storageInstance.updateSettings({ currency: e.target.value });
        showToast('Валюта обновлена', 'success');
        if (window.app && window.app.refreshHeader) {
            window.app.refreshHeader();
        }
    });
    
    document.getElementById('theme-toggle')?.addEventListener('change', (e) => {
        if (window.app && window.app.toggleTheme) {
            window.app.toggleTheme();
        } else {
            // Fallback
            const html = document.documentElement;
            const current = html.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            storageInstance.updateSettings({ theme: next });
            showToast(`${next === 'dark' ? 'Темная' : 'Светлая'} тема`, 'success');
            document.dispatchEvent(new Event('theme-changed'));
        }
    });
    
    document.getElementById('export-data')?.addEventListener('click', exportData);
    document.getElementById('import-data')?.addEventListener('click', () => document.getElementById('import-file')?.click());
    document.getElementById('import-file')?.addEventListener('change', importData);
    document.getElementById('clear-data')?.addEventListener('click', clearAllData);
    
    // ===== ИЗМЕНЕНИЕ: Обработчик сворачивания/разворачивания опасной зоны =====
    document.getElementById('danger-zone-toggle')?.addEventListener('click', () => {
        const content = document.getElementById('danger-zone-content');
        const icon = document.getElementById('danger-zone-icon');
        
        if (content) {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                if (icon) {
                    icon.textContent = '▲';
                    icon.style.transform = 'rotate(180deg)';
                }
            } else {
                content.style.display = 'none';
                if (icon) {
                    icon.textContent = '▼';
                    icon.style.transform = 'rotate(0deg)';
                }
            }
        }
    });
}

function exportData() {
    const data = storageInstance.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Данные экспортированы', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.transactions && data.categories) {
                storageInstance.saveData(data);
                showToast('Данные импортированы', 'success');
                if (window.app && window.app.refreshHeader) {
                    window.app.refreshHeader();
                }
                location.reload();
            } else {
                showToast('Неверный формат файла', 'error');
            }
        } catch (err) {
            showToast('Ошибка импорта', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function clearAllData() {
    if (confirm('ВСЕ ДАННЫЕ БУДУТ УДАЛЕНЫ! Продолжить?')) {
        if (confirm('Вы уверены? Это действие нельзя отменить!')) {
            localStorage.removeItem('budgetApp');
            showToast('Все данные удалены', 'info');
            setTimeout(() => location.reload(), 1000);
        }
    }
}