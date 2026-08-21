// ===== modules/debts.js =====
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let storageInstance = null;
let currentFilter = 'all';
let currentCategoryFilter = 'all';
let repeatCheckInterval = null;

export function init(storage) {
    storageInstance = storage;
    renderDebts();
    setupEventListeners();
    startRepeatCheck();
    populateCategoryFilter();
}

function startRepeatCheck() {
    if (repeatCheckInterval) {
        clearInterval(repeatCheckInterval);
    }
    repeatCheckInterval = setInterval(() => {
        checkRepeatingDebts();
    }, 5 * 60 * 1000);
    setTimeout(checkRepeatingDebts, 1000);
}

function checkRepeatingDebts() {
    const debts = getDebts();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updated = false;
    
    debts.forEach(debt => {
        if (!debt.repeatEnabled || debt.repeatType === 'none') return;
        if (!debt.lastRepeatDate) return;
        
        const lastDate = new Date(debt.lastRepeatDate);
        lastDate.setHours(0, 0, 0, 0);
        
        let nextDate = new Date(lastDate);
        let shouldCreate = false;
        
        switch (debt.repeatType) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + (debt.repeatInterval || 1));
                if (nextDate <= today) shouldCreate = true;
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + (debt.repeatInterval || 1) * 7);
                if (nextDate <= today) shouldCreate = true;
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + (debt.repeatInterval || 1));
                if (nextDate <= today) shouldCreate = true;
                break;
            case 'yearly':
                nextDate.setFullYear(nextDate.getFullYear() + (debt.repeatInterval || 1));
                if (nextDate <= today) shouldCreate = true;
                break;
        }
        
        if (shouldCreate) {
            if (debt.lastRepeatDateEnd) {
                const endDate = new Date(debt.lastRepeatDateEnd);
                endDate.setHours(0, 0, 0, 0);
                if (nextDate > endDate) {
                    debt.repeatEnabled = false;
                    updated = true;
                    return;
                }
            }
            
            const newDebt = {
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6),
                title: debt.title,
                amount: debt.amount,
                categoryId: debt.categoryId,
                subcategoryId: debt.subcategoryId || null,
                paidAmount: 0,
                dueDate: debt.dueDate || '',
                comment: debt.comment || '',
                createdAt: new Date().toISOString(),
                repeatEnabled: true,
                repeatType: debt.repeatType,
                repeatInterval: debt.repeatInterval || 1,
                lastRepeatDate: nextDate.toISOString().split('T')[0],
                lastRepeatDateEnd: debt.lastRepeatDateEnd,
                parentDebtId: debt.id,
                transactionIds: [],
                showOnDashboard: true
            };
            
            const allDebts = getDebts();
            allDebts.push(newDebt);
            saveDebts(allDebts);
            
            debt.lastRepeatDate = nextDate.toISOString().split('T')[0];
            updated = true;
            
            showToast(`Создан повторяющийся долг: ${debt.title}`, 'info');
        }
    });
    
    if (updated) {
        saveDebts(debts);
        renderDebts();
    }
}

// ===== ФУНКЦИЯ: Проверка, попадает ли долг в текущий месяц =====
function isDebtInCurrentMonth(debt) {
    // Проверяем, есть ли у долга дата оплаты
    if (!debt.dueDate) return false;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Парсим дату оплаты
    const dueDate = new Date(debt.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    
    // Проверяем, попадает ли дата оплаты в текущий месяц
    const dueDateInMonth = dueDate.getMonth() === currentMonth && dueDate.getFullYear() === currentYear;
    
    return dueDateInMonth;
}

function getDebts() {
    const data = storageInstance.getData();
    return data.debts || [];
}

function saveDebts(debts) {
    const data = storageInstance.getData();
    data.debts = debts;
    storageInstance.saveData(data);
}

// ===== ФУНКЦИЯ: Заполнение фильтра по категориям =====
function populateCategoryFilter() {
    const container = document.getElementById('debt-category-filter');
    if (!container) return;
    
    const debts = getDebts();
    const categories = storageInstance.getCategories();
    
    // Собираем все категории, которые используются в долгах
    const usedCategoryIds = new Set();
    debts.forEach(debt => {
        if (debt.categoryId) {
            usedCategoryIds.add(debt.categoryId);
        }
        if (debt.subcategoryId) {
            usedCategoryIds.add(debt.subcategoryId);
        }
    });
    
    // Получаем родительские категории
    let parentCategories = categories.filter(c => 
        c.type === 'expense' && 
        !c.parentId && 
        usedCategoryIds.has(c.id)
    );
    
    // Исключаем только "Перетяжку"
    const excludedCategories = ['перетяжка'];
    parentCategories = parentCategories.filter(c => !excludedCategories.includes(c.name.toLowerCase()));
    
    let html = `
        <button class="debt-category-filter-btn active" data-category="all" style="
            padding: 4px 10px;
            border: 1px solid var(--color-text);
            background: var(--color-text);
            color: var(--color-bg);
            border-radius: var(--radius-sm);
            font-family: var(--font-family);
            font-size: var(--font-size-xs);
            font-weight: 500;
            cursor: pointer;
            transition: var(--transition);
            white-space: nowrap;
        ">Все</button>
    `;
    
    parentCategories.forEach(cat => {
        const color = cat.color || '#666666';
        const count = debts.filter(debt => {
            // Проверяем, относится ли долг к этой категории или её подкатегории
            const category = categories.find(c => c.id === debt.categoryId);
            return category?.parentId === cat.id || debt.categoryId === cat.id;
        }).length;
        
        if (count > 0) {
            html += `
                <button class="debt-category-filter-btn" data-category="${cat.id}" data-color="${color}" style="
                    padding: 4px 10px;
                    border: 1px solid var(--color-border);
                    background: transparent;
                    color: ${color};
                    border-radius: var(--radius-sm);
                    font-family: var(--font-family);
                    font-size: var(--font-size-xs);
                    font-weight: 500;
                    cursor: pointer;
                    transition: var(--transition);
                    white-space: nowrap;
                ">${cat.icon || '◻'} ${cat.name}</button>
            `;
        }
    });
    
    container.innerHTML = html;
    
    // Обработчики для кнопок фильтра
    document.querySelectorAll('.debt-category-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.debt-category-filter-btn').forEach(b => {
                b.classList.remove('active');
                b.style.border = '1px solid var(--color-border)';
                b.style.background = 'transparent';
                b.style.color = b.dataset.color || 'var(--color-text-secondary)';
            });
            
            this.classList.add('active');
            this.style.border = '1px solid var(--color-text)';
            this.style.background = 'var(--color-text)';
            this.style.color = 'var(--color-bg)';
            
            currentCategoryFilter = this.dataset.category;
            renderDebts();
        });
    });
}

// ===== ФУНКЦИЯ: renderDebts =====
function renderDebts() {
    const debts = getDebts();
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense');
    
    // Фильтр по типу (все/активные/погашенные/текущий месяц)
    let filtered = debts;
    if (currentFilter === 'active') {
        filtered = debts.filter(d => d.paidAmount < d.amount);
    } else if (currentFilter === 'paid') {
        filtered = debts.filter(d => d.paidAmount >= d.amount);
    } else if (currentFilter === 'month') {
        // Фильтр для текущего месяца — только долги с датой оплаты в этом месяце
        filtered = debts.filter(debt => isDebtInCurrentMonth(debt));
    }

    // Фильтр по категории
    if (currentCategoryFilter !== 'all') {
        filtered = filtered.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            const isParentCategory = !category?.parentId && debt.categoryId === currentCategoryFilter;
            const isSubCategory = category?.parentId === currentCategoryFilter;
            return isParentCategory || isSubCategory;
        });
    }

    filtered.sort((a, b) => {
        const aPaid = a.paidAmount >= a.amount;
        const bPaid = b.paidAmount >= b.amount;
        if (aPaid && !bPaid) return 1;
        if (!aPaid && bPaid) return -1;
        return 0;
    });

    const container = document.getElementById('debts-grid');
    if (!container) return;

    // Обновляем статистику с учётом фильтра по типу и категории
    let statsDebts = debts;
    if (currentFilter === 'active') {
        statsDebts = debts.filter(d => d.paidAmount < d.amount);
    } else if (currentFilter === 'paid') {
        statsDebts = debts.filter(d => d.paidAmount >= d.amount);
    } else if (currentFilter === 'month') {
        statsDebts = debts.filter(debt => isDebtInCurrentMonth(debt));
    }
    
    if (currentCategoryFilter !== 'all') {
        statsDebts = statsDebts.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            const isParentCategory = !category?.parentId && debt.categoryId === currentCategoryFilter;
            const isSubCategory = category?.parentId === currentCategoryFilter;
            return isParentCategory || isSubCategory;
        });
    }

    const totalDebts = statsDebts.reduce((sum, d) => sum + d.amount, 0);
    const totalPaid = statsDebts.reduce((sum, d) => sum + (d.paidAmount || 0), 0);
    const remaining = totalDebts - totalPaid;

    document.getElementById('total-debts').textContent = totalDebts.toFixed(2) + ' ₽';
    document.getElementById('remaining-debts').textContent = remaining.toFixed(2) + ' ₽';
    document.getElementById('paid-debts').textContent = totalPaid.toFixed(2) + ' ₽';

    if (!filtered.length) {
        container.innerHTML = `
            <div class="debt-card" style="grid-column: 1 / -1; min-height: 200px; display: flex; align-items: center; justify-content: center;">
                <div class="empty-state">
                    <span class="icon">◆</span>
                    <p>Нет долгов</p>
                    <button class="btn btn-primary" id="add-first-debt" style="margin-top:12px;">+ Добавить долг</button>
                </div>
            </div>
        `;
        document.getElementById('add-first-debt')?.addEventListener('click', openAddDebtModal);
        return;
    }

    container.innerHTML = filtered.map(debt => {
        const category = expenseCategories.find(c => c.id === debt.categoryId);
        const subcategory = debt.subcategoryId ? expenseCategories.find(c => c.id === debt.subcategoryId) : null;
        const color = subcategory?.color || category?.color || '#666666';
        const icon = subcategory?.icon || category?.icon || '◆';
        const isPaid = debt.paidAmount >= debt.amount;
        const paidPercent = Math.min((debt.paidAmount / debt.amount) * 100, 100);
        const status = isPaid ? 'paid' : (debt.paidAmount > 0 ? 'partial' : 'active');
        const statusLabels = {
            paid: 'Погашен',
            partial: 'Частично',
            active: 'Активен'
        };
        
        const categoryName = subcategory?.name || category?.name || 'Без категории';
        const repeatLabel = getRepeatLabel(debt.repeatType, debt.repeatInterval);
        const hasTransactions = debt.transactionIds && debt.transactionIds.length > 0;
        const showOnDashboard = debt.showOnDashboard !== false;

        return `
            <div class="debt-card" data-debt-id="${debt.id}">
                <div class="debt-header">
                    <span class="debt-title" style="color: ${color};">${icon} ${debt.title}</span>
                    <span class="debt-status ${status}">${statusLabels[status]}</span>
                </div>
                <div class="debt-category">${categoryName} ${repeatLabel ? '🔄 ' + repeatLabel : ''}</div>
                <div class="debt-amount">
                    ${debt.amount.toFixed(2)} ₽
                    ${debt.paidAmount > 0 ? `<span class="paid-amount">(погашено ${debt.paidAmount.toFixed(2)} ₽)</span>` : ''}
                </div>
                <div class="debt-progress">
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${paidPercent}%; background: ${isPaid ? '#22C55E' : color};"></div>
                    </div>
                    <span class="progress-text">${paidPercent.toFixed(0)}%</span>
                </div>
                <div class="debt-meta">
                    <span>${debt.dueDate ? 'До: ' + formatDate(debt.dueDate) : 'Без срока'}</span>
                    <span>${debt.comment || ''}</span>
                </div>
                ${debt.repeatEnabled && debt.lastRepeatDate ? `
                    <div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;">
                        <span>Последнее обновление: ${formatDate(debt.lastRepeatDate)}</span>
                        ${debt.lastRepeatDateEnd ? `<span>До: ${formatDate(debt.lastRepeatDateEnd)}</span>` : ''}
                    </div>
                ` : ''}
                <div class="debt-actions">
                    <button class="btn-toggle-visibility" data-id="${debt.id}" style="${showOnDashboard ? '' : 'opacity:0.6;'}">
                        ${showOnDashboard ? 'Скрыть' : 'Показать'}
                    </button>
                    ${!isPaid ? `
                        <button class="btn-pay-full" data-id="${debt.id}">💰 Погасить полностью</button>
                        <button class="btn-pay-partial" data-id="${debt.id}">📊 Частично</button>
                    ` : `
                        <button class="btn-restore-debt" data-id="${debt.id}">↩ Вернуть</button>
                    `}
                    ${debt.paidAmount > 0 ? `<button class="btn-reset-debt" data-id="${debt.id}">⟲ Обнулить</button>` : ''}
                    <button class="btn-edit-debt" data-id="${debt.id}">✎</button>
                    <button class="btn-delete-debt" data-id="${debt.id}">✕</button>
                </div>
                ${hasTransactions ? `
                    <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;border-top:1px solid var(--color-border);padding-top:4px;">
                        Связано транзакций: ${debt.transactionIds.length}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // Обработчики для кнопок
    document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            toggleDebtVisibility(id);
        });
    });

    document.querySelectorAll('.btn-pay-full').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            openPayDebtModal(id, 'full');
        });
    });

    document.querySelectorAll('.btn-pay-partial').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            openPayDebtModal(id, 'partial');
        });
    });

    document.querySelectorAll('.btn-restore-debt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            restoreDebt(id);
        });
    });

    document.querySelectorAll('.btn-reset-debt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            resetDebt(id);
        });
    });

    document.querySelectorAll('.btn-edit-debt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            openEditDebtModal(id);
        });
    });

    document.querySelectorAll('.btn-delete-debt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            deleteDebt(id);
        });
    });
}

function toggleDebtVisibility(id) {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    debt.showOnDashboard = debt.showOnDashboard === false ? true : false;
    saveDebts(debts);
    renderDebts();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" ${debt.showOnDashboard ? 'показан' : 'скрыт'} на главной`, 'success');
}

function getRepeatLabel(repeatType, interval) {
    const labels = {
        'none': '',
        'daily': `Каждые ${interval || 1} дн.`,
        'weekly': `Каждые ${interval || 1} нед.`,
        'monthly': `Каждые ${interval || 1} мес.`,
        'yearly': `Каждые ${interval || 1} год.`
    };
    return labels[repeatType] || '';
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function setupEventListeners() {
    document.querySelectorAll('.debt-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.debt-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentFilter = e.currentTarget.dataset.type;
            renderDebts();
        });
    });

    document.getElementById('add-debt-btn')?.addEventListener('click', openAddDebtModal);

    document.addEventListener('transaction-added', renderDebts);
    document.addEventListener('transaction-deleted', renderDebts);
}

function openAddDebtModal() {
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId);

    const categoryOptions = expenseCategories.map(c => 
        `<option value="${c.id}">${c.icon || '◆'} ${c.name}</option>`
    ).join('');

    const today = new Date().toISOString().split('T')[0];

    openModal('Добавить долг', `
        <form id="debt-form">
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Название долга *</label>
                <input name="title" type="text" placeholder="Например: Долг другу" required 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма *</label>
                <input name="amount" type="number" step="0.01" placeholder="Сумма долга" required 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Категория *</label>
                <select name="categoryId" id="debt-category-select" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                    <option value="">Выберите категорию</option>
                    ${categoryOptions}
                </select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Подкатегория</label>
                <select name="subcategoryId" id="debt-subcategory-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                    <option value="">Без подкатегории</option>
                </select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Срок (необязательно)</label>
                <input name="dueDate" type="date" value="${today}" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
                <div style="flex:2;">
                    <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Периодичность</label>
                    <select name="repeatType" id="debt-repeat-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                        <option value="none">Без повтора</option>
                        <option value="daily">Ежедневно</option>
                        <option value="weekly">Еженедельно</option>
                        <option value="monthly">Ежемесячно</option>
                        <option value="yearly">Ежегодно</option>
                    </select>
                </div>
                <div style="flex:1;">
                    <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Интервал</label>
                    <input name="repeatInterval" type="number" min="1" value="1" id="debt-repeat-interval"
                           style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                </div>
            </div>
            <div id="repeat-end-date-container" style="margin-bottom:12px;display:none;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Последняя дата повтора (после этой даты долг не будет создаваться)</label>
                <input name="repeatEndDate" type="date" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Оставьте пустым для бесконечного повтора</span>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий (необязательно)</label>
                <textarea name="comment" placeholder="Комментарий" 
                          style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:60px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);"></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Сохранить</button>
        </form>
    `, (formData) => {
        const repeatType = formData.repeatType || 'none';
        const repeatInterval = parseInt(formData.repeatInterval) || 1;
        const repeatEndDate = formData.repeatEndDate || '';
        const todayStr = new Date().toISOString().split('T')[0];
        
        const debt = {
            id: Date.now().toString(),
            title: formData.title,
            amount: parseFloat(formData.amount),
            categoryId: formData.categoryId,
            subcategoryId: formData.subcategoryId || null,
            paidAmount: 0,
            dueDate: formData.dueDate || '',
            comment: formData.comment || '',
            createdAt: new Date().toISOString(),
            repeatEnabled: repeatType !== 'none',
            repeatType: repeatType,
            repeatInterval: repeatInterval,
            lastRepeatDate: repeatType !== 'none' ? todayStr : '',
            lastRepeatDateEnd: repeatEndDate || '',
            parentDebtId: null,
            transactionIds: [],
            showOnDashboard: true
        };

        const debts = getDebts();
        debts.push(debt);
        saveDebts(debts);
        renderDebts();
        populateCategoryFilter();
        showToast('Долг добавлен', 'success');
    });

    setTimeout(() => {
        const repeatSelect = document.getElementById('debt-repeat-select');
        const endDateContainer = document.getElementById('repeat-end-date-container');
        const intervalInput = document.getElementById('debt-repeat-interval');
        
        if (repeatSelect && endDateContainer) {
            repeatSelect.addEventListener('change', function() {
                if (this.value !== 'none') {
                    endDateContainer.style.display = 'block';
                    if (intervalInput) intervalInput.disabled = false;
                } else {
                    endDateContainer.style.display = 'none';
                    if (intervalInput) intervalInput.disabled = true;
                }
            });
            if (repeatSelect.value !== 'none') {
                endDateContainer.style.display = 'block';
                if (intervalInput) intervalInput.disabled = false;
            } else {
                if (intervalInput) intervalInput.disabled = true;
            }
        }

        const categorySelect = document.getElementById('debt-category-select');
        const subcategorySelect = document.getElementById('debt-subcategory-select');
        
        if (categorySelect && subcategorySelect) {
            categorySelect.addEventListener('change', function() {
                const selectedId = this.value;
                const categories = storageInstance.getCategories();
                const subcategories = categories.filter(c => c.type === 'expense' && c.parentId === selectedId);
                
                subcategorySelect.innerHTML = '<option value="">Без подкатегории</option>';
                subcategories.forEach(sub => {
                    subcategorySelect.innerHTML += `<option value="${sub.id}">${sub.icon || '◆'} ${sub.name}</option>`;
                });
            });
        }
    }, 100);
}

function openEditDebtModal(id) {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId);

    const categoryOptions = expenseCategories.map(c => 
        `<option value="${c.id}" ${c.id === debt.categoryId ? 'selected' : ''}>${c.icon || '◆'} ${c.name}</option>`
    ).join('');

    const subcategories = categories.filter(c => c.type === 'expense' && c.parentId === debt.categoryId);
    const subcategoryOptions = subcategories.map(sub => 
        `<option value="${sub.id}" ${sub.id === debt.subcategoryId ? 'selected' : ''}>${sub.icon || '◆'} ${sub.name}</option>`
    ).join('');

    const showEndDate = debt.repeatType && debt.repeatType !== 'none' ? 'block' : 'none';
    const intervalDisabled = debt.repeatType === 'none' ? 'disabled' : '';

    openModal('Редактировать долг', `
        <form id="debt-form">
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Название долга *</label>
                <input name="title" type="text" value="${debt.title}" required 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма *</label>
                <input name="amount" type="number" step="0.01" value="${debt.amount}" required 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Погашено</label>
                <input name="paidAmount" type="number" step="0.01" value="${debt.paidAmount || 0}" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Категория *</label>
                <select name="categoryId" id="debt-category-select-edit" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                    <option value="">Выберите категорию</option>
                    ${categoryOptions}
                </select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Подкатегория</label>
                <select name="subcategoryId" id="debt-subcategory-select-edit" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                    <option value="">Без подкатегории</option>
                    ${subcategoryOptions}
                </select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Срок</label>
                <input name="dueDate" type="date" value="${debt.dueDate || ''}" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
                <div style="flex:2;">
                    <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Периодичность</label>
                    <select name="repeatType" id="debt-repeat-select-edit" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                        <option value="none" ${debt.repeatType === 'none' ? 'selected' : ''}>Без повтора</option>
                        <option value="daily" ${debt.repeatType === 'daily' ? 'selected' : ''}>Ежедневно</option>
                        <option value="weekly" ${debt.repeatType === 'weekly' ? 'selected' : ''}>Еженедельно</option>
                        <option value="monthly" ${debt.repeatType === 'monthly' ? 'selected' : ''}>Ежемесячно</option>
                        <option value="yearly" ${debt.repeatType === 'yearly' ? 'selected' : ''}>Ежегодно</option>
                    </select>
                </div>
                <div style="flex:1;">
                    <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Интервал</label>
                    <input name="repeatInterval" type="number" min="1" value="${debt.repeatInterval || 1}" id="debt-repeat-interval-edit" ${intervalDisabled}
                           style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                </div>
            </div>
            <div id="repeat-end-date-container-edit" style="margin-bottom:12px;display:${showEndDate};">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Последняя дата повтора</label>
                <input name="repeatEndDate" type="date" value="${debt.lastRepeatDateEnd || ''}" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Оставьте пустым для бесконечного повтора</span>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий</label>
                <textarea name="comment" placeholder="Комментарий" 
                          style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:60px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);">${debt.comment || ''}</textarea>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Показывать на главной</label>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer;">
                        <input type="radio" name="showOnDashboard" value="true" ${debt.showOnDashboard !== false ? 'checked' : ''}> Да
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer;">
                        <input type="radio" name="showOnDashboard" value="false" ${debt.showOnDashboard === false ? 'checked' : ''}> Нет
                    </label>
                </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Обновить</button>
        </form>
    `, (formData) => {
        const repeatType = formData.repeatType || 'none';
        const repeatInterval = parseInt(formData.repeatInterval) || 1;
        const todayStr = new Date().toISOString().split('T')[0];
        const showOnDashboard = formData.showOnDashboard === 'true';
        
        const updated = {
            title: formData.title,
            amount: parseFloat(formData.amount),
            paidAmount: parseFloat(formData.paidAmount) || 0,
            categoryId: formData.categoryId,
            subcategoryId: formData.subcategoryId || null,
            dueDate: formData.dueDate || '',
            comment: formData.comment || '',
            repeatEnabled: repeatType !== 'none',
            repeatType: repeatType,
            repeatInterval: repeatInterval,
            lastRepeatDate: repeatType !== 'none' ? (debt.lastRepeatDate || todayStr) : '',
            lastRepeatDateEnd: formData.repeatEndDate || '',
            showOnDashboard: showOnDashboard
        };

        const debts = getDebts();
        const index = debts.findIndex(d => d.id === id);
        if (index !== -1) {
            debts[index] = { ...debts[index], ...updated };
            saveDebts(debts);
            renderDebts();
            populateCategoryFilter();
            document.dispatchEvent(new Event('debt-updated'));
            showToast('Долг обновлен', 'success');
        }
    });

    setTimeout(() => {
        const repeatSelect = document.getElementById('debt-repeat-select-edit');
        const endDateContainer = document.getElementById('repeat-end-date-container-edit');
        const intervalInput = document.getElementById('debt-repeat-interval-edit');
        
        if (repeatSelect && endDateContainer) {
            repeatSelect.addEventListener('change', function() {
                if (this.value !== 'none') {
                    endDateContainer.style.display = 'block';
                    if (intervalInput) intervalInput.disabled = false;
                } else {
                    endDateContainer.style.display = 'none';
                    if (intervalInput) intervalInput.disabled = true;
                }
            });
        }

        const categorySelect = document.getElementById('debt-category-select-edit');
        const subcategorySelect = document.getElementById('debt-subcategory-select-edit');
        
        if (categorySelect && subcategorySelect) {
            categorySelect.addEventListener('change', function() {
                const selectedId = this.value;
                const categories = storageInstance.getCategories();
                const subcategories = categories.filter(c => c.type === 'expense' && c.parentId === selectedId);
                const currentSub = subcategorySelect.value;
                
                subcategorySelect.innerHTML = '<option value="">Без подкатегории</option>';
                subcategories.forEach(sub => {
                    const selected = sub.id === currentSub ? 'selected' : '';
                    subcategorySelect.innerHTML += `<option value="${sub.id}" ${selected}>${sub.icon || '◆'} ${sub.name}</option>`;
                });
            });
        }
    }, 100);
}

function openPayDebtModal(id, mode = 'full') {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    const remaining = debt.amount - (debt.paidAmount || 0);
    const isFull = mode === 'full';

    const title = isFull ? 'Погасить долг полностью' : 'Частичное погашение долга';
    const buttonText = isFull ? '💰 Погасить полностью' : '📊 Пополнить частично';
    const defaultAmount = isFull ? remaining : 0;

    openModal(title, `
        <form id="pay-debt-form">
            <div style="text-align:center;padding:8px 0;">
                <div style="font-size:var(--font-size-lg);font-weight:600;margin-bottom:4px;">${debt.title}</div>
                <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">
                    Остаток: <span style="font-weight:600;color:var(--color-text);">${remaining.toFixed(2)} ₽</span>
                </div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:4px;">
                    Общая сумма: ${debt.amount.toFixed(2)} ₽ • Погашено: ${(debt.paidAmount || 0).toFixed(2)} ₽
                </div>
                ${!isFull ? `
                    <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--color-text-muted);">
                        Введите сумму, которую хотите погасить
                    </div>
                ` : ''}
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">
                    Сумма погашения *
                </label>
                <input name="payAmount" type="number" step="0.01" 
                       value="${defaultAmount}" 
                       min="0.01" max="${remaining}" 
                       ${isFull ? 'readonly' : 'required'} 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:${isFull ? 'var(--color-bg-secondary)' : 'var(--color-bg-input)'};color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                ${!isFull ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Максимум: ${remaining.toFixed(2)} ₽</span>` : ''}
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата погашения</label>
                <input name="payDate" type="date" value="${new Date().toISOString().split('T')[0]}" 
                       style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий к погашению (необязательно)</label>
                <textarea name="payComment" placeholder="Например: Оплата за июнь" 
                          style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:40px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);"></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">${buttonText}</button>
        </form>
    `, (formData) => {
        const payAmount = parseFloat(formData.payAmount);
        if (payAmount <= 0 || payAmount > remaining) {
            showToast('Некорректная сумма', 'error');
            return;
        }

        const debts = getDebts();
        const index = debts.findIndex(d => d.id === id);
        if (index === -1) {
            showToast('Долг не найден', 'error');
            return;
        }

        debts[index].paidAmount = (debts[index].paidAmount || 0) + payAmount;
        saveDebts(debts);
        renderDebts();

        const category = storageInstance.getCategory(debt.categoryId);
        const subcategory = debt.subcategoryId ? storageInstance.getCategory(debt.subcategoryId) : null;
        
        const transaction = {
            type: 'expense',
            amount: payAmount,
            category: debt.subcategoryId || debt.categoryId,
            categoryName: subcategory?.name || category?.name || 'Погашение долга',
            date: formData.payDate || new Date().toISOString().split('T')[0],
            description: `Погашение долга: ${debt.title}`,
            comment: formData.payComment || `Погашено ${payAmount.toFixed(2)} ₽ из ${debt.amount.toFixed(2)} ₽`,
            photo: '',
            isDebtPayment: true
        };
        
        const savedTransaction = storageInstance.addTransaction(transaction);
        
        if (savedTransaction && savedTransaction.id) {
            if (!debts[index].transactionIds) {
                debts[index].transactionIds = [];
            }
            debts[index].transactionIds.push(savedTransaction.id);
            saveDebts(debts);
        }
        
        showToast(`Погашено ${payAmount.toFixed(2)} ₽`, 'success');
        document.dispatchEvent(new Event('transaction-added'));
        document.dispatchEvent(new Event('debt-updated'));
        
        if (debts[index].paidAmount >= debts[index].amount) {
            showToast(`Долг "${debt.title}" полностью погашен! 🎉`, 'success');
        }
    });
}

function restoreDebt(id) {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    if (!confirm(`Вернуть долг "${debt.title}" в активные?`)) return;

    const index = debts.findIndex(d => d.id === id);
    if (index === -1) {
        showToast('Долг не найден', 'error');
        return;
    }

    if (debt.transactionIds && debt.transactionIds.length > 0) {
        let deletedCount = 0;
        debt.transactionIds.forEach(transactionId => {
            const transaction = storageInstance.getTransaction(transactionId);
            if (transaction) {
                storageInstance.deleteTransaction(transactionId);
                deletedCount++;
            }
        });
        if (deletedCount > 0) {
            showToast(`Удалено ${deletedCount} транзакций`, 'info');
        }
    }

    debts[index].paidAmount = 0;
    debts[index].transactionIds = [];
    saveDebts(debts);
    renderDebts();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" возвращен в активные`, 'success');
    document.dispatchEvent(new Event('transaction-deleted'));
}

function resetDebt(id) {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    if (!confirm(`Обнулить долг "${debt.title}"? Все связанные транзакции будут удалены.`)) return;

    const index = debts.findIndex(d => d.id === id);
    if (index === -1) {
        showToast('Долг не найден', 'error');
        return;
    }

    if (debt.transactionIds && debt.transactionIds.length > 0) {
        let deletedCount = 0;
        debt.transactionIds.forEach(transactionId => {
            const transaction = storageInstance.getTransaction(transactionId);
            if (transaction) {
                storageInstance.deleteTransaction(transactionId);
                deletedCount++;
            }
        });
        showToast(`Удалено ${deletedCount} транзакций`, 'info');
    }

    debts[index].paidAmount = 0;
    debts[index].transactionIds = [];
    saveDebts(debts);
    renderDebts();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" обнулен`, 'success');
    document.dispatchEvent(new Event('transaction-deleted'));
}

function deleteDebt(id) {
    const debts = getDebts();
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    let message = `Удалить долг "${debt.title}"?`;
    if (debt.transactionIds && debt.transactionIds.length > 0) {
        message += `\n\nСвязано транзакций: ${debt.transactionIds.length}. Они также будут удалены.`;
    }

    if (confirm(message)) {
        if (debt.transactionIds && debt.transactionIds.length > 0) {
            debt.transactionIds.forEach(transactionId => {
                const transaction = storageInstance.getTransaction(transactionId);
                if (transaction) {
                    storageInstance.deleteTransaction(transactionId);
                }
            });
        }
        
        const newDebts = debts.filter(d => d.id !== id);
        saveDebts(newDebts);
        renderDebts();
        populateCategoryFilter();
        document.dispatchEvent(new Event('debt-updated'));
        showToast('Долг удален', 'success');
        document.dispatchEvent(new Event('transaction-deleted'));
    }
}