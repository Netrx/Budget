// ===== modules/debts.js =====
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

let storageInstance = null;
let currentFilter = 'all';
let currentCategoryFilter = 'all';
let repeatCheckInterval = null;

export function init(storage) {
    storageInstance = storage;
    
    migrateExistingDebts();
    generateAllPeriods();
    archiveCompletedDebts();
    
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
        updateDebtStatuses();
        archiveCompletedDebts();
        generateAllPeriods();
    }, 60 * 1000);
    
    setTimeout(() => {
        checkRepeatingDebts();
        updateDebtStatuses();
        archiveCompletedDebts();
        generateAllPeriods();
    }, 1000);
}

// ===== МИГРАЦИЯ: переносим старые дочерние долги в поле periods родительского долга =====
function migrateExistingDebts() {
    const allDebts = getDebts();
    let needsSave = false;
    
    const childDebts = allDebts.filter(d => d.parentDebtId);
    childDebts.forEach(child => {
        const parent = allDebts.find(d => d.id === child.parentDebtId);
        if (parent) {
            if (!parent.periods) parent.periods = [];
            parent.periods.push({
                id: child.id,
                amount: child.amount,
                paidAmount: child.paidAmount || 0,
                dueDate: child.dueDate || '',
                comment: child.comment || '',
                paymentDate: child.paymentDate || '',
                isOverdue: child.isOverdue || false,
                transactionIds: child.transactionIds || []
            });
            needsSave = true;
        }
    });
    
    const filtered = allDebts.filter(d => !d.parentDebtId);
    filtered.forEach(debt => {
        if (!debt.periods) debt.periods = [];
        if (debt.isArchived === undefined) {
            if ((debt.paidAmount || 0) >= debt.amount && (!debt.repeatEnabled || debt.repeatType === 'none')) {
                debt.isArchived = true;
                debt.archivedAt = debt.archivedAt || new Date().toISOString();
            } else {
                debt.isArchived = false;
            }
            needsSave = true;
        }
        if (debt.isOverdue === undefined) {
            debt.isOverdue = false;
            needsSave = true;
        }
        if (debt.baseAmount === undefined) {
            debt.baseAmount = debt.amount;
            needsSave = true;
        }
        if (debt.periods.length > 0) {
            const totalAmount = debt.periods.reduce((sum, p) => sum + p.amount, 0);
            const totalPaid = debt.periods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
            debt.amount = totalAmount;
            debt.paidAmount = totalPaid;
        }
    });
    
    if (needsSave) {
        saveDebts(filtered);
    }
}

// ===== ГЕНЕРАЦИЯ ПЕРИОДОВ =====
function getNextPeriodDate(debt, today) {
    const interval = debt.repeatInterval || 1;
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    switch (debt.repeatType) {
        case 'daily': date.setDate(date.getDate() + interval); break;
        case 'weekly': date.setDate(date.getDate() + interval * 7); break;
        case 'monthly': date.setMonth(date.getMonth() + interval); break;
        case 'yearly': date.setFullYear(date.getFullYear() + interval); break;
        default: break;
    }
    return date;
}

function generateAllPeriods() {
    const allDebts = getDebts();
    let updated = false;
    
    allDebts.forEach(debt => {
        if (debt.isArchived) return;
        if (!debt.repeatEnabled || debt.repeatType === 'none') return;
        if (!debt.periods) debt.periods = [];
        
        const created = debt.createdAt ? new Date(debt.createdAt) : null;
        if (!created) return;
        created.setHours(0, 0, 0, 0);
        
        let paymentDay = created.getDate();
        if (debt.dueDate) {
            const due = new Date(debt.dueDate);
            if (!isNaN(due.getTime())) {
                paymentDay = due.getDate();
            }
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        
        let currentDate = new Date(created);
        if (currentDate.getDate() > paymentDay) {
            currentDate.setMonth(currentDate.getMonth() + (debt.repeatInterval || 1));
        }
        currentDate.setDate(paymentDay);
        
        let endDate = null;
        if (debt.lastRepeatDateEnd) {
            const end = new Date(debt.lastRepeatDateEnd);
            end.setHours(0, 0, 0, 0);
            if (!isNaN(end.getTime())) {
                endDate = end;
            } else {
                endDate = getNextPeriodDate(debt, new Date(today));
            }
        } else {
            endDate = getNextPeriodDate(debt, new Date(today));
        }
        
        const existingPeriods = debt.periods;
        const existingDates = new Set(existingPeriods.map(p => p.dueDate));
        
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            
            if (!existingDates.has(dateStr)) {
                const isPast = dateStr <= todayStr;
                const shouldBePaid = isPast && debt.lastRepeatDateEnd ? true : false;
                
                existingPeriods.push({
                    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6),
                    amount: debt.baseAmount || debt.amount,
                    paidAmount: shouldBePaid ? (debt.baseAmount || debt.amount) : 0,
                    dueDate: dateStr,
                    comment: shouldBePaid ? 'Оплачен автоматически' : 'Ожидает оплаты',
                    paymentDate: shouldBePaid ? dateStr : '',
                    transactionIds: []
                });
                updated = true;
            }
            
            switch (debt.repeatType) {
                case 'daily': currentDate.setDate(currentDate.getDate() + (debt.repeatInterval || 1)); break;
                case 'weekly': currentDate.setDate(currentDate.getDate() + (debt.repeatInterval || 1) * 7); break;
                case 'monthly': currentDate.setMonth(currentDate.getMonth() + (debt.repeatInterval || 1)); break;
                case 'yearly': currentDate.setFullYear(currentDate.getFullYear() + (debt.repeatInterval || 1)); break;
                default: currentDate = null;
            }
            
            if (!currentDate) break;
        }
        
        const totalAmount = existingPeriods.reduce((sum, p) => sum + p.amount, 0);
        const totalPaid = existingPeriods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        debt.amount = totalAmount;
        debt.paidAmount = totalPaid;
        
        existingPeriods.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    });
    
    if (updated) {
        saveDebts(allDebts);
    }
}

// ===== АВТОМАТИЧЕСКАЯ АРХИВАЦИЯ ОПЛАЧЕННЫХ ДОЛГОВ =====
function archiveCompletedDebts() {
    const allDebts = getDebts();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updated = false;
    
    allDebts.forEach(debt => {
        const isPaid = (debt.paidAmount || 0) >= debt.amount;
        
        if (isPaid && !debt.isArchived) {
            if (debt.repeatEnabled && debt.repeatType !== 'none') {
                const endDateStr = debt.lastRepeatDateEnd;
                if (endDateStr) {
                    const endDate = new Date(endDateStr);
                    endDate.setHours(0, 0, 0, 0);
                    
                    if (today > endDate) {
                        debt.isArchived = true;
                        debt.archivedAt = new Date().toISOString();
                        updated = true;
                    }
                }
            } else {
                debt.isArchived = true;
                debt.archivedAt = new Date().toISOString();
                updated = true;
            }
        }
    });
    
    if (updated) {
        saveDebts(allDebts);
        renderDebts();
        document.dispatchEvent(new Event('debt-updated'));
    }
}

// ===== ОБНОВЛЕНИЕ СТАТУСОВ =====
function updateDebtStatuses() {
    const allDebts = getDebts();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updated = false;
    
    allDebts.forEach(debt => {
        if (debt.isArchived) return;
        
        const isPaid = (debt.paidAmount || 0) >= debt.amount;
        
        if (debt.periods) {
            debt.periods.forEach(period => {
                if (period.dueDate && (period.paidAmount || 0) < period.amount) {
                    const dueDate = new Date(period.dueDate + 'T00:00:00');
                    if (dueDate <= today && !period.isOverdue) {
                        period.isOverdue = true;
                        updated = true;
                    } else if (dueDate > today && period.isOverdue) {
                        period.isOverdue = false;
                        updated = true;
                    }
                }
            });
        }
        
        if (!isPaid && debt.dueDate && !debt.repeatEnabled) {
            const dueDate = new Date(debt.dueDate + 'T00:00:00');
            
            if (dueDate <= today && !debt.isOverdue) {
                debt.isOverdue = true;
                updated = true;
                
                if ('Notification' in window && Notification.permission === 'granted') {
                    try {
                        new Notification('Просрочен платеж!', {
                            body: `Долг "${debt.title}" должен быть оплачен до ${formatDate(debt.dueDate)}`,
                            tag: `budget-app-overdue-${debt.id}`
                        });
                    } catch (error) {
                        console.warn('Не удалось показать уведомление о просрочке:', error);
                    }
                }
            } else if (dueDate > today && debt.isOverdue) {
                debt.isOverdue = false;
                updated = true;
            }
        }
    });
    
    if (updated) {
        saveDebts(allDebts);
        renderDebts();
        document.dispatchEvent(new Event('debt-updated'));
        if (window.app && window.app.refreshHeader) {
            window.app.refreshHeader();
        }
    }
}

function checkRepeatingDebts() {
    const allDebts = getDebts();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updated = false;
    
    allDebts.forEach(debt => {
        if (debt.isArchived) return;
        
        if (!debt.repeatEnabled || debt.repeatType === 'none') return;
        if (!debt.lastRepeatDate) return;
        
        const lastDate = new Date(debt.lastRepeatDate + 'T00:00:00');
        
        let nextDate = new Date(lastDate);
        let shouldCreate = false;
        
        switch (debt.repeatType) {
            case 'daily': nextDate.setDate(nextDate.getDate() + (debt.repeatInterval || 1)); if (nextDate <= today) shouldCreate = true; break;
            case 'weekly': nextDate.setDate(nextDate.getDate() + (debt.repeatInterval || 1) * 7); if (nextDate <= today) shouldCreate = true; break;
            case 'monthly': nextDate.setMonth(nextDate.getMonth() + (debt.repeatInterval || 1)); if (nextDate <= today) shouldCreate = true; break;
            case 'yearly': nextDate.setFullYear(nextDate.getFullYear() + (debt.repeatInterval || 1)); if (nextDate <= today) shouldCreate = true; break;
        }
        
        if (shouldCreate) {
            if (debt.lastRepeatDateEnd) {
                const endDate = new Date(debt.lastRepeatDateEnd + 'T00:00:00');
                if (nextDate > endDate) {
                    debt.repeatEnabled = false;
                    updated = true;
                    return;
                }
            }
            
            if (!debt.periods) debt.periods = [];
            debt.periods.push({
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6),
                amount: debt.baseAmount || debt.amount,
                paidAmount: 0,
                dueDate: nextDate.toISOString().split('T')[0],
                comment: 'Ожидает оплаты',
                paymentDate: '',
                transactionIds: []
            });
            updated = true;
        }
    });
    
    if (updated) {
        saveDebts(allDebts);
        renderDebts();
    }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function isDebtInCurrentMonth(debt) {
    if (!debt.periods || debt.periods.length === 0) {
        if (!debt.dueDate) return false;
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const dueDate = new Date(debt.dueDate + 'T00:00:00');
        return dueDate.getMonth() === currentMonth && dueDate.getFullYear() === currentYear;
    }
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    return debt.periods.some(period => {
        if (!period.dueDate) return false;
        const dueDate = new Date(period.dueDate + 'T00:00:00');
        return dueDate.getMonth() === currentMonth && dueDate.getFullYear() === currentYear;
    });
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

// ===== ФИЛЬТР ПО КАТЕГОРИЯМ =====
function populateCategoryFilter() {
    const container = document.getElementById('debt-category-filter');
    if (!container) return;
    
    const allDebts = getDebts();
    const categories = storageInstance.getCategories();
    
    const usedCategoryIds = new Set();
    allDebts.forEach(debt => {
        if (debt.categoryId) usedCategoryIds.add(debt.categoryId);
        if (debt.subcategoryId) usedCategoryIds.add(debt.subcategoryId);
    });
    
    let parentCategories = categories.filter(c => c.type === 'expense' && !c.parentId && usedCategoryIds.has(c.id));
    const excludedCategories = ['перетяжка'];
    parentCategories = parentCategories.filter(c => !excludedCategories.includes(c.name.toLowerCase()));
    
    let html = `
        <button class="debt-category-filter-btn active" data-category="all" style="
            padding: 4px 10px; border: 1px solid var(--color-text); background: var(--color-text);
            color: var(--color-bg); border-radius: var(--radius-sm); font-family: var(--font-family);
            font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition);
            white-space: nowrap;">Все</button>
    `;
    
    parentCategories.forEach(cat => {
        const color = cat.color || '#666666';
        const count = allDebts.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            return category?.parentId === cat.id || debt.categoryId === cat.id;
        }).length;
        
        if (count > 0) {
            html += `
                <button class="debt-category-filter-btn" data-category="${cat.id}" data-color="${color}" style="
                    padding: 4px 10px; border: 1px solid var(--color-border); background: transparent;
                    color: ${color}; border-radius: var(--radius-sm); font-family: var(--font-family);
                    font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition);
                    white-space: nowrap;">${cat.name}</button>
            `;
        }
    });
    
    container.innerHTML = html;
    
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

// ===== ОТОБРАЖЕНИЕ ДОЛГОВ (ИСПРАВЛЕННАЯ ЛОГИКА) =====
function renderDebts() {
    const allDebts = getDebts();
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense');
    
    let filtered = allDebts.filter(d => !d.parentDebtId);
    
    if (currentFilter === 'archive') {
        filtered = filtered.filter(d => d.isArchived === true);
    } else {
        filtered = filtered.filter(d => d.isArchived !== true);
        if (currentFilter === 'active') {
            filtered = filtered.filter(d => d.paidAmount < d.amount);
        } else if (currentFilter === 'paid') {
            filtered = filtered.filter(d => d.paidAmount >= d.amount && (!d.repeatEnabled || d.repeatType === 'none'));
        } else if (currentFilter === 'month') {
            filtered = filtered.filter(debt => isDebtInCurrentMonth(debt));
        }
    }

    if (currentCategoryFilter !== 'all') {
        filtered = filtered.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            const isParentCategory = !category?.parentId && debt.categoryId === currentCategoryFilter;
            const isSubCategory = category?.parentId === currentCategoryFilter;
            return isParentCategory || isSubCategory;
        });
    }

    // СОРТИРОВКА: просроченные долги ВСЕГДА первыми
    if (currentFilter !== 'archive') {
        filtered.sort((a, b) => {
            const aOverdue = (a.isOverdue === true && (a.paidAmount || 0) < a.amount && a.repeatEnabled && a.repeatType !== 'none');
            const bOverdue = (b.isOverdue === true && (b.paidAmount || 0) < b.amount && b.repeatEnabled && b.repeatType !== 'none');
            if (aOverdue && !bOverdue) return -1;
            if (!aOverdue && bOverdue) return 1;
            const aPaid = (a.paidAmount || 0) >= a.amount;
            const bPaid = (b.paidAmount || 0) >= b.amount;
            if (aPaid && !bPaid) return 1;
            if (!aPaid && bPaid) return -1;
            return 0;
        });
    } else {
        filtered.sort((a, b) => {
            const dateA = new Date(a.archivedAt || 0);
            const dateB = new Date(b.archivedAt || 0);
            return dateB - dateA;
        });
    }

    const container = document.getElementById('debts-grid');
    if (!container) return;

    let statsDebts = allDebts.filter(d => !d.parentDebtId && d.isArchived !== true);
    if (currentFilter === 'active') statsDebts = statsDebts.filter(d => d.paidAmount < d.amount);
    else if (currentFilter === 'paid') statsDebts = statsDebts.filter(d => d.paidAmount >= d.amount);
    else if (currentFilter === 'month') statsDebts = statsDebts.filter(debt => isDebtInCurrentMonth(debt));
    
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
        const emptyMessage = currentFilter === 'archive' ? 'Архив пуст' : 'Нет долгов';
        container.innerHTML = `
            <div class="debt-card" style="grid-column: 1 / -1; min-height: 200px; display: flex; align-items: center; justify-content: center;">
                <div class="empty-state">
                    <span class="icon">◆</span>
                    <p>${emptyMessage}</p>
                    ${currentFilter !== 'archive' ? `<button class="btn btn-primary" id="add-first-debt" style="margin-top:12px;">+ Добавить долг</button>` : ''}
                </div>
            </div>
        `;
        document.getElementById('add-first-debt')?.addEventListener('click', openAddDebtModal);
        return;
    }

    container.innerHTML = filtered.map(debt => {
        const isArchived = debt.isArchived === true;
        const category = expenseCategories.find(c => c.id === debt.categoryId);
        const subcategory = debt.subcategoryId ? expenseCategories.find(c => c.id === debt.subcategoryId) : null;
        const color = subcategory?.color || category?.color || '#666666';
        const isPaid = debt.paidAmount >= debt.amount;
        
        const isRepeat = debt.repeatEnabled && debt.repeatType !== 'none';
        const periods = debt.periods || [];
        
        let displayAmount = debt.amount;
        let paidPercent = Math.min((debt.paidAmount / debt.amount) * 100, 100);
        let nextPeriod = null;
        let periodToDisplay = null;
        
        // ===== ПРАВИЛЬНАЯ ЛОГИКА: ЕСЛИ ДАТА ПРОШЛА → СЛЕДУЮЩИЙ ПЕРИОД =====
        if (isRepeat) {
            const sortedPeriods = [...periods].sort((a, b) => new Date(a.dueDate + 'T00:00:00') - new Date(b.dueDate + 'T00:00:00'));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Находим ближайший период, дата которого <= сегодня
            const currentOrOverdue = sortedPeriods.find(p => {
                const dueDate = new Date(p.dueDate + 'T00:00:00');
                return dueDate <= today;
            });
            
            // Находим следующий период после текущего/просроченного
            let nextAfterCurrent = null;
            if (currentOrOverdue) {
                const currentIndex = sortedPeriods.indexOf(currentOrOverdue);
                nextAfterCurrent = sortedPeriods[currentIndex + 1] || null;
            } else {
                // Если все периоды в будущем - показываем первый
                nextAfterCurrent = sortedPeriods[0] || null;
            }
            
            // ЛОГИКА:
            if (currentOrOverdue) {
                // Если текущий/просроченный период НЕ оплачен → показываем ЕГО (0%)
                if ((currentOrOverdue.paidAmount || 0) < currentOrOverdue.amount) {
                    periodToDisplay = currentOrOverdue;
                } else {
                    // Если текущий/просроченный период ОПЛАЧЕН → показываем СЛЕДУЮЩИЙ (0%)
                    if (nextAfterCurrent) {
                        periodToDisplay = nextAfterCurrent;
                    } else {
                        // Нет следующих - показываем текущий (100%)
                        periodToDisplay = currentOrOverdue;
                    }
                }
            } else {
                // Если все периоды в будущем - показываем первый (0%)
                periodToDisplay = nextAfterCurrent;
            }
            
            if (periodToDisplay) {
                displayAmount = periodToDisplay.amount;
                paidPercent = Math.min(((periodToDisplay.paidAmount || 0) / displayAmount) * 100, 100);
            } else {
                displayAmount = debt.baseAmount || 0;
                paidPercent = 100;
            }
            
            nextPeriod = sortedPeriods.find(p => (p.paidAmount || 0) < p.amount);
        }
        
        const isOverdue = (periodToDisplay && (periodToDisplay.paidAmount || 0) < periodToDisplay.amount && new Date(periodToDisplay.dueDate + 'T00:00:00') <= new Date()) ? true : false;
        const status = isArchived ? 'archived' : (isPaid ? 'paid' : (isOverdue ? 'overdue' : (debt.paidAmount > 0 ? 'partial' : 'active')));
        const statusLabels = { paid: 'Погашен', partial: 'Частично', active: 'Активен', overdue: 'Просрочен', archived: 'В архиве' };
        
        const categoryName = subcategory?.name || category?.name || 'Без категории';
        const repeatLabel = getRepeatLabel(debt.repeatType, debt.repeatInterval);
        const hasTransactions = debt.transactionIds && debt.transactionIds.length > 0;
        const showOnDashboard = debt.showOnDashboard !== false;
        const archivedDate = debt.archivedAt ? `Архивирован: ${formatDate(debt.archivedAt.slice(0, 10))}` : '';

        const totalAll = debt.amount;
        const totalPaidAll = debt.periods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        const totalRemainingAll = Math.max(totalAll - totalPaidAll, 0);

        const visibleHistoryPeriods = isRepeat ? periods : periods;

        return `
            <div class="debt-card" data-debt-id="${debt.id}" style="${isOverdue ? 'border-color: #EF4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.1);' : ''}${isArchived ? 'opacity: 0.7; background: var(--color-bg-secondary);' : ''}">
                <div class="debt-header">
                    <span class="debt-title" style="color: ${isOverdue ? '#EF4444' : color};">${debt.title}</span>
                    <span class="debt-status ${status}">${statusLabels[status]}</span>
                </div>
                <div class="debt-category">${categoryName} ${repeatLabel ? '🔄 ' + repeatLabel : ''}</div>
                <div class="debt-amount">
                    ${displayAmount.toFixed(2)} ₽
                    ${debt.paidAmount > 0 ? `<span class="paid-amount">(погашено ${debt.paidAmount.toFixed(2)} ₽)</span>` : ''}
                </div>
                <div class="debt-progress">
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${paidPercent}%; background: ${isPaid ? '#22C55E' : (isOverdue ? '#EF4444' : color)};"></div>
                    </div>
                    <span class="progress-text">${paidPercent.toFixed(0)}%</span>
                </div>
                <div class="debt-meta">
                    <span style="${isOverdue ? 'color: #EF4444; font-weight: bold;' : ''}">${periodToDisplay?.dueDate ? (isOverdue ? 'Срок истек: ' : 'До: ') + formatDate(periodToDisplay.dueDate) : (debt.dueDate ? 'До: ' + formatDate(debt.dueDate) : 'Без срока')}</span>
                    <span>${periodToDisplay?.comment || debt.comment || ''}</span>
                </div>
                <div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;">
                    <span>Создан: ${debt.createdAt ? formatDate(debt.createdAt.slice(0, 10)) : '—'}</span>
                </div>
                ${archivedDate ? `<div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;"><span>${archivedDate}</span></div>` : ''}
                ${debt.repeatEnabled && debt.lastRepeatDate ? `
                    <div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;">
                        <span>Последнее обновление: ${formatDate(debt.lastRepeatDate)}</span>
                        ${debt.lastRepeatDateEnd ? `<span>До: ${formatDate(debt.lastRepeatDateEnd)}</span>` : ''}
                    </div>
                ` : ''}
                <div class="debt-actions">
                    ${isArchived ? `
                        <button class="btn-restore-debt" data-id="${debt.id}">↩ Вернуть</button>
                        <button class="btn-delete-debt" data-id="${debt.id}">✕</button>
                    ` : `
                        <button class="btn-toggle-visibility" data-id="${debt.id}" style="${showOnDashboard ? '' : 'opacity:0.6;'}">
                            ${showOnDashboard ? 'Скрыть' : 'Показать'}
                        </button>
                        ${!isPaid ? `
                            <button class="btn-pay-full" data-id="${debt.id}">💰 Погасить</button>
                            ${isRepeat && nextPeriod ? `<button class="btn-pay-current-period" data-id="${debt.id}">📅 Оплатить месяц</button>` : ''}
                            <button class="btn-pay-partial" data-id="${debt.id}">📊 Частично</button>
                        ` : `
                            <button class="btn-restore-debt" data-id="${debt.id}">↩ Вернуть</button>
                            <button class="btn-archive-debt" data-id="${debt.id}">📦 Архив</button>
                        `}
                        ${debt.paidAmount > 0 ? `<button class="btn-reset-debt" data-id="${debt.id}">⟲ Обнулить</button>` : ''}
                        <button class="btn-edit-debt" data-id="${debt.id}">✎</button>
                        <button class="btn-delete-debt" data-id="${debt.id}">✕</button>
                    `}
                </div>
                ${hasTransactions ? `
                    <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;border-top:1px solid var(--color-border);padding-top:4px;">
                        Связано транзакций: ${debt.transactionIds.length}
                    </div>
                ` : ''}
                ${isRepeat ? `
                    <div class="debt-repeat-info" style="margin-top:8px;border-top:1px solid var(--color-border);padding-top:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-secondary);margin-bottom:4px;">
                            <span>Периодов: ${visibleHistoryPeriods.length}</span>
                            <span>Всего: ${totalAll.toFixed(2)} ₽</span>
                            <span>Оплачено: ${totalPaidAll.toFixed(2)} ₽</span>
                            <span>Осталось: ${totalRemainingAll.toFixed(2)} ₽</span>
                        </div>
                        <div style="display:flex;gap:4px;margin-bottom:6px;">
                            <button class="btn-add-period" data-id="${debt.id}" style="
                                padding: 2px 8px; border: 1px solid var(--color-border); background: transparent;
                                color: var(--color-text-secondary); border-radius: var(--radius-sm); font-family: var(--font-family);
                                font-size: 10px; cursor: pointer; transition: var(--transition);
                            ">+ Добавить период</button>
                            <button class="btn-toggle-history" data-id="${debt.id}" style="
                                padding: 2px 8px; border: 1px solid var(--color-border); background: transparent;
                                color: var(--color-text-secondary); border-radius: var(--radius-sm); font-family: var(--font-family);
                                font-size: 10px; cursor: pointer; transition: var(--transition);
                            ">Показать историю</button>
                        </div>
                        <div class="repeat-history" style="display:none;margin-top:8px;background:var(--color-bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                            ${visibleHistoryPeriods.map(period => {
                                const periodRemaining = Math.max(period.amount - (period.paidAmount || 0), 0);
                                const periodStatus = period.paidAmount >= period.amount ? '✓' : (period.isOverdue ? '🔥' : '○');
                                return `
                                    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-text-secondary);">
                                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${period.dueDate ? formatDate(period.dueDate) : 'Без даты'}</span>
                                        <span style="margin-left:8px;font-weight:600;color:${period.paidAmount >= period.amount ? '#22C55E' : '#EF4444'};">${period.amount.toFixed(2)} ₽</span>
                                        <span style="margin-left:8px;">оплачено ${(period.paidAmount || 0).toFixed(2)} ₽</span>
                                        <span style="margin-left:8px;color:${periodRemaining > 0 ? '#EF4444' : '#22C55E'};">осталось ${periodRemaining.toFixed(2)} ₽</span>
                                        ${period.paymentDate ? `<span style="margin-left:8px;">оплачено ${formatDate(period.paymentDate)}</span>` : ''}
                                        <span style="margin-left:8px;">${periodStatus}</span>
                                        <span style="margin-left:4px;display:inline-flex;gap:2px;">
                                            <button class="btn-edit-period" data-id="${period.id}" data-parent-id="${debt.id}" style="
                                                padding: 1px 4px; border: none; background: transparent;
                                                color: var(--color-text-muted); font-size: 10px; cursor: pointer;
                                                border-radius: var(--radius-sm); transition: var(--transition);
                                            ">✎</button>
                                            <button class="btn-delete-period" data-id="${period.id}" data-parent-id="${debt.id}" style="
                                                padding: 1px 4px; border: none; background: transparent;
                                                color: var(--color-text-muted); font-size: 10px; cursor: pointer;
                                                border-radius: var(--radius-sm); transition: var(--transition);
                                            ">✕</button>
                                        </span>
                                    </div>
                                `;
                            }).join('')}
                            ${visibleHistoryPeriods.length === 0 ? '<div style="font-size:10px;color:var(--color-text-muted);">Ещё нет созданных периодов</div>' : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
        btn.addEventListener('click', (e) => toggleDebtVisibility(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-pay-full').forEach(btn => {
        btn.addEventListener('click', (e) => openPayDebtModal(e.currentTarget.dataset.id, 'full'));
    });
    document.querySelectorAll('.btn-pay-partial').forEach(btn => {
        btn.addEventListener('click', (e) => openPayDebtModal(e.currentTarget.dataset.id, 'partial'));
    });
    document.querySelectorAll('.btn-pay-current-period').forEach(btn => {
        btn.addEventListener('click', (e) => payCurrentPeriod(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-restore-debt').forEach(btn => {
        btn.addEventListener('click', (e) => restoreDebt(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-archive-debt').forEach(btn => {
        btn.addEventListener('click', (e) => archiveDebt(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-reset-debt').forEach(btn => {
        btn.addEventListener('click', (e) => resetDebt(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-edit-debt').forEach(btn => {
        btn.addEventListener('click', (e) => openEditDebtModal(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-delete-debt').forEach(btn => {
        btn.addEventListener('click', (e) => deleteDebt(e.currentTarget.dataset.id));
    });

    document.querySelectorAll('.btn-toggle-history').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = e.currentTarget.closest('.debt-card');
            const historyBlock = card.querySelector('.repeat-history');
            const isHidden = historyBlock.style.display === 'none';
            historyBlock.style.display = isHidden ? 'block' : 'none';
            e.currentTarget.textContent = isHidden ? 'Скрыть историю' : 'Показать историю';
        });
    });
    document.querySelectorAll('.btn-add-period').forEach(btn => {
        btn.addEventListener('click', (e) => openAddPeriodModal(e.currentTarget.dataset.id));
    });
    document.querySelectorAll('.btn-edit-period').forEach(btn => {
        btn.addEventListener('click', (e) => openEditPeriodModal(e.currentTarget.dataset.id, e.currentTarget.dataset.parentId));
    });
    document.querySelectorAll('.btn-delete-period').forEach(btn => {
        btn.addEventListener('click', (e) => deletePeriod(e.currentTarget.dataset.id, e.currentTarget.dataset.parentId));
    });
}

// ===== ОБРАБОТЧИКИ ДЕЙСТВИЙ =====
function toggleDebtVisibility(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    debt.showOnDashboard = debt.showOnDashboard === false ? true : false;
    saveDebts(allDebts);
    renderDebts();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" ${debt.showOnDashboard ? 'показан' : 'скрыт'} на главной`, 'success');
}

function archiveDebt(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    if (!confirm(`Отправить долг "${debt.title}" в архив?`)) return;
    debt.isArchived = true;
    debt.archivedAt = new Date().toISOString();
    saveDebts(allDebts);
    renderDebts();
    populateCategoryFilter();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" перемещен в архив`, 'success');
}

function getRepeatLabel(repeatType, interval) {
    const labels = { 'none': '', 'daily': `Каждые ${interval || 1} дн.`, 'weekly': `Каждые ${interval || 1} нед.`, 'monthly': `Каждые ${interval || 1} мес.`, 'yearly': `Каждые ${interval || 1} год.` };
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

// ===== ДОБАВЛЕНИЕ/РЕДАКТИРОВАНИЕ ДОЛГА =====
function openAddDebtModal() {
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId);
    const categoryOptions = expenseCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const today = new Date().toISOString().split('T')[0];

    openModal('Добавить долг', `
        <form id="debt-form">
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Название долга *</label>
                <input name="title" type="text" placeholder="Например: Долг другу" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма одного периода *</label>
                <input name="amount" type="number" step="0.01" placeholder="Сумма долга" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Категория *</label>
                <select name="categoryId" id="debt-category-select" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="">Выберите категорию</option>${categoryOptions}</select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Подкатегория</label>
                <select name="subcategoryId" id="debt-subcategory-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="">Без подкатегории</option></select>
            </div>
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Первый срок</label>
                <input name="dueDate" type="date" value="${today}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
                <div style="flex:2;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Периодичность</label><select name="repeatType" id="debt-repeat-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="none">Без повтора</option><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option></select></div>
                <div style="flex:1;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Интервал</label><input name="repeatInterval" type="number" min="1" value="1" id="debt-repeat-interval" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            </div>
            <div id="repeat-end-date-container" style="margin-bottom:12px;display:none;">
                <label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Последняя дата повтора</label>
                <input name="repeatEndDate" type="date" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Оставьте пустым для бесконечного повтора</span>
            </div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий</label><textarea name="comment" placeholder="Комментарий" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:60px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);"></textarea></div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Сохранить</button>
        </form>
    `, (formData) => {
        const repeatType = formData.repeatType || 'none';
        const repeatInterval = parseInt(formData.repeatInterval) || 1;
        const repeatEndDate = formData.repeatEndDate || '';
        const todayStr = new Date().toISOString().split('T')[0];
        
        const debt = {
            id: Date.now().toString(), title: formData.title,
            baseAmount: parseFloat(formData.amount), amount: parseFloat(formData.amount),
            categoryId: formData.categoryId, subcategoryId: formData.subcategoryId || null,
            paidAmount: 0, dueDate: formData.dueDate || '', comment: formData.comment || '',
            createdAt: new Date().toISOString(), repeatEnabled: repeatType !== 'none',
            repeatType: repeatType, repeatInterval: repeatInterval,
            lastRepeatDate: repeatType !== 'none' ? todayStr : '', lastRepeatDateEnd: repeatEndDate || '',
            periods: [], transactionIds: [], showOnDashboard: true, isOverdue: false, isArchived: false
        };

        const allDebts = getDebts();
        allDebts.push(debt);
        saveDebts(allDebts);
        
        if (debt.repeatEnabled && debt.repeatType !== 'none') generatePeriodsForDebt(debt);
        
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
                if (this.value !== 'none') { endDateContainer.style.display = 'block'; if (intervalInput) intervalInput.disabled = false; }
                else { endDateContainer.style.display = 'none'; if (intervalInput) intervalInput.disabled = true; }
            });
            if (repeatSelect.value !== 'none') { endDateContainer.style.display = 'block'; if (intervalInput) intervalInput.disabled = false; }
            else { if (intervalInput) intervalInput.disabled = true; }
        }
        const categorySelect = document.getElementById('debt-category-select');
        const subcategorySelect = document.getElementById('debt-subcategory-select');
        if (categorySelect && subcategorySelect) {
            categorySelect.addEventListener('change', function() {
                const selectedId = this.value;
                const subcategories = storageInstance.getCategories().filter(c => c.type === 'expense' && c.parentId === selectedId);
                subcategorySelect.innerHTML = '<option value="">Без подкатегории</option>';
                subcategories.forEach(sub => subcategorySelect.innerHTML += `<option value="${sub.id}">${sub.name}</option>`);
            });
        }
    }, 100);
}

function openEditDebtModal(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId);
    const categoryOptions = expenseCategories.map(c => `<option value="${c.id}" ${c.id === debt.categoryId ? 'selected' : ''}>${c.name}</option>`).join('');
    const subcategories = categories.filter(c => c.type === 'expense' && c.parentId === debt.categoryId);
    const subcategoryOptions = subcategories.map(sub => `<option value="${sub.id}" ${sub.id === debt.subcategoryId ? 'selected' : ''}>${sub.name}</option>`).join('');
    const showEndDate = debt.repeatType && debt.repeatType !== 'none' ? 'block' : 'none';
    const intervalDisabled = debt.repeatType === 'none' ? 'disabled' : '';

    openModal('Редактировать долг', `
        <form id="debt-form">
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Название долга *</label><input name="title" type="text" value="${debt.title}" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма одного периода *</label><input name="baseAmount" type="number" step="0.01" value="${debt.baseAmount || debt.amount}" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Погашено (общая)</label><input name="paidAmount" type="number" step="0.01" value="${debt.paidAmount || 0}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Категория *</label><select name="categoryId" id="debt-category-select-edit" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="">Выберите категорию</option>${categoryOptions}</select></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Подкатегория</label><select name="subcategoryId" id="debt-subcategory-select-edit" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="">Без подкатегории</option>${subcategoryOptions}</select></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Первый срок</label><input name="dueDate" type="date" value="${debt.dueDate || ''}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
                <div style="flex:2;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Периодичность</label><select name="repeatType" id="debt-repeat-select-edit" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><option value="none" ${debt.repeatType === 'none' ? 'selected' : ''}>Без повтора</option><option value="daily" ${debt.repeatType === 'daily' ? 'selected' : ''}>Ежедневно</option><option value="weekly" ${debt.repeatType === 'weekly' ? 'selected' : ''}>Еженедельно</option><option value="monthly" ${debt.repeatType === 'monthly' ? 'selected' : ''}>Ежемесячно</option><option value="yearly" ${debt.repeatType === 'yearly' ? 'selected' : ''}>Ежегодно</option></select></div>
                <div style="flex:1;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Интервал</label><input name="repeatInterval" type="number" min="1" value="${debt.repeatInterval || 1}" id="debt-repeat-interval-edit" ${intervalDisabled} style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            </div>
            <div id="repeat-end-date-container-edit" style="margin-bottom:12px;display:${showEndDate};"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Последняя дата повтора</label><input name="repeatEndDate" type="date" value="${debt.lastRepeatDateEnd || ''}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"><span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Оставьте пустым для бесконечного повтора</span></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий</label><textarea name="comment" placeholder="Комментарий" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:60px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);">${debt.comment || ''}</textarea></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Показывать на главной</label><div style="display:flex;align-items:center;gap:8px;margin-top:4px;"><label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer;"><input type="radio" name="showOnDashboard" value="true" ${debt.showOnDashboard !== false ? 'checked' : ''}> Да</label><label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer;"><input type="radio" name="showOnDashboard" value="false" ${debt.showOnDashboard === false ? 'checked' : ''}> Нет</label></div></div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Обновить</button>
        </form>
    `, (formData) => {
        const repeatType = formData.repeatType || 'none';
        const repeatInterval = parseInt(formData.repeatInterval) || 1;
        const todayStr = new Date().toISOString().split('T')[0];
        const showOnDashboard = formData.showOnDashboard === 'true';
        
        const updated = { title: formData.title, baseAmount: parseFloat(formData.baseAmount), paidAmount: parseFloat(formData.paidAmount) || 0, categoryId: formData.categoryId, subcategoryId: formData.subcategoryId || null, dueDate: formData.dueDate || '', comment: formData.comment || '', repeatEnabled: repeatType !== 'none', repeatType: repeatType, repeatInterval: repeatInterval, lastRepeatDate: repeatType !== 'none' ? (debt.lastRepeatDate || todayStr) : '', lastRepeatDateEnd: formData.repeatEndDate || '', showOnDashboard: showOnDashboard };

        const allDebts = getDebts();
        const index = allDebts.findIndex(d => d.id === id);
        if (index !== -1) {
            allDebts[index] = { ...allDebts[index], ...updated };
            if (allDebts[index].periods && allDebts[index].periods.length > 0) allDebts[index].amount = allDebts[index].periods.reduce((sum, p) => sum + p.amount, 0);
            else allDebts[index].amount = allDebts[index].baseAmount;
            saveDebts(allDebts);
            if (allDebts[index].repeatEnabled && allDebts[index].repeatType !== 'none') generatePeriodsForDebt(allDebts[index]);
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
        if (repeatSelect && endDateContainer) repeatSelect.addEventListener('change', function() {
            if (this.value !== 'none') { endDateContainer.style.display = 'block'; if (intervalInput) intervalInput.disabled = false; }
            else { endDateContainer.style.display = 'none'; if (intervalInput) intervalInput.disabled = true; }
        });
        const categorySelect = document.getElementById('debt-category-select-edit');
        const subcategorySelect = document.getElementById('debt-subcategory-select-edit');
        if (categorySelect && subcategorySelect) categorySelect.addEventListener('change', function() {
            const selectedId = this.value;
            const subcategories = storageInstance.getCategories().filter(c => c.type === 'expense' && c.parentId === selectedId);
            const currentSub = subcategorySelect.value;
            subcategorySelect.innerHTML = '<option value="">Без подкатегории</option>';
            subcategories.forEach(sub => subcategorySelect.innerHTML += `<option value="${sub.id}" ${sub.id === currentSub ? 'selected' : ''}>${sub.name}</option>`);
        });
    }, 100);
}

// ===== ГЕНЕРАЦИЯ ПЕРИОДОВ ДЛЯ КОНКРЕТНОГО ДОЛГА =====
function generatePeriodsForDebt(debt) {
    if (!debt.repeatEnabled || debt.repeatType === 'none') return;
    const allDebts = getDebts();
    const index = allDebts.findIndex(d => d.id === debt.id);
    if (index === -1) return;
    const created = debt.createdAt ? new Date(debt.createdAt) : new Date(); created.setHours(0, 0, 0, 0);
    let paymentDay = created.getDate(); if (debt.dueDate) { const due = new Date(debt.dueDate); if (!isNaN(due.getTime())) paymentDay = due.getDate(); }
    const today = new Date(); today.setHours(0, 0, 0, 0); const todayStr = today.toISOString().split('T')[0];
    let endDate = null;
    if (debt.lastRepeatDateEnd) { 
        const end = new Date(debt.lastRepeatDateEnd); 
        end.setHours(0, 0, 0, 0); 
        if (!isNaN(end.getTime())) endDate = end; else endDate = getNextPeriodDate(debt, new Date(today)); 
    } else {
        endDate = getNextPeriodDate(debt, new Date(today));
    }
    const existingPeriods = allDebts[index].periods || [];
    const existingDates = new Set(existingPeriods.map(p => p.dueDate));
    let currentDate = new Date(created); if (currentDate.getDate() > paymentDay) currentDate.setMonth(currentDate.getMonth() + (debt.repeatInterval || 1)); currentDate.setDate(paymentDay);
    while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) {
            const isPast = dateStr <= todayStr;
            const shouldBePaid = isPast && debt.lastRepeatDateEnd ? true : false;
            existingPeriods.push({ id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6), amount: debt.baseAmount || debt.amount, paidAmount: shouldBePaid ? (debt.baseAmount || debt.amount) : 0, dueDate: dateStr, comment: shouldBePaid ? 'Оплачен автоматически' : 'Ожидает оплаты', paymentDate: shouldBePaid ? dateStr : '', transactionIds: [] });
        }
        switch (debt.repeatType) {
            case 'daily': currentDate.setDate(currentDate.getDate() + (debt.repeatInterval || 1)); break;
            case 'weekly': currentDate.setDate(currentDate.getDate() + (debt.repeatInterval || 1) * 7); break;
            case 'monthly': currentDate.setMonth(currentDate.getMonth() + (debt.repeatInterval || 1)); break;
            case 'yearly': currentDate.setFullYear(currentDate.getFullYear() + (debt.repeatInterval || 1)); break;
            default: currentDate = null;
        }
        if (!currentDate) break;
    }
    const totalAmount = existingPeriods.reduce((sum, p) => sum + p.amount, 0);
    const totalPaid = existingPeriods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
    allDebts[index].amount = totalAmount; allDebts[index].paidAmount = totalPaid;
    saveDebts(allDebts);
}

// ===== ОПЛАТА ДОЛГА =====
function openPayDebtModal(id, mode = 'full') {
    const allDebts = getDebts();
    const debtIndex = allDebts.findIndex(d => d.id === id);
    if (debtIndex === -1) { showToast('Долг не найден', 'error'); return; }
    const debt = allDebts[debtIndex];
    const remaining = debt.amount - (debt.paidAmount || 0);
    const isFull = mode === 'full';
    const title = isFull ? 'Погасить долг полностью' : 'Частичное погашение долга';
    const buttonText = isFull ? '💰 Погасить полностью' : '📊 Пополнить частично';
    const defaultAmount = isFull ? remaining : 0;

    openModal(title, `
        <form id="pay-debt-form">
            <div style="text-align:center;padding:8px 0;">
                <div style="font-size:var(--font-size-lg);font-weight:600;margin-bottom:4px;">${debt.title}</div>
                <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);">Остаток: <span style="font-weight:600;color:var(--color-text);">${remaining.toFixed(2)} ₽</span></div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:4px;">Общая сумма: ${debt.amount.toFixed(2)} ₽ • Погашено: ${(debt.paidAmount || 0).toFixed(2)} ₽</div>
                ${!isFull ? `<div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--color-text-muted);">Введите сумму, которую хотите погасить</div>` : ''}
            </div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма погашения *</label>
                <input name="payAmount" type="number" step="0.01" value="${defaultAmount}" min="0.01" max="${remaining}" ${isFull ? 'readonly' : 'required'} style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:${isFull ? 'var(--color-bg-secondary)' : 'var(--color-bg-input)'};color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
                ${!isFull ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">Максимум: ${remaining.toFixed(2)} ₽</span>` : ''}
            </div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата погашения</label>
                <input name="payDate" type="date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий к погашению (необязательно)</label>
                <textarea name="payComment" placeholder="Например: Оплата за июнь" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:40px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);"></textarea>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">${buttonText}</button>
        </form>
    `, (formData) => {
        const payAmount = parseFloat(formData.payAmount);
        if (payAmount <= 0 || payAmount > remaining) { showToast('Некорректная сумма', 'error'); return; }

        let periodToPay = null;
        if (debt.periods && debt.periods.length > 0) periodToPay = debt.periods.find(p => (p.paidAmount || 0) < p.amount);
        if (periodToPay) {
            const periodRemaining = periodToPay.amount - (periodToPay.paidAmount || 0);
            const appliedAmount = Math.min(payAmount, periodRemaining);
            periodToPay.paidAmount = (periodToPay.paidAmount || 0) + appliedAmount;
            periodToPay.paymentDate = formData.payDate || new Date().toISOString().split('T')[0];
            if (!periodToPay.transactionIds) periodToPay.transactionIds = [];
        }
        debt.paidAmount = (debt.paidAmount || 0) + payAmount;
        saveDebts(allDebts);

        const category = storageInstance.getCategory(debt.categoryId);
        const subcategory = debt.subcategoryId ? storageInstance.getCategory(debt.subcategoryId) : null;
        const transaction = {
            type: 'expense', amount: payAmount, category: debt.categoryId,
            categoryName: category?.name || 'Погашение долга',
            subcategoryId: debt.subcategoryId || null, subcategoryName: subcategory?.name || '',
            date: formData.payDate || new Date().toISOString().split('T')[0],
            description: `Погашение долга: ${debt.title}`,
            comment: formData.payComment || `Погашено ${payAmount.toFixed(2)} ₽ из ${debt.amount.toFixed(2)} ₽`,
            photo: '', isDebtPayment: true
        };
        
        const savedTransaction = storageInstance.addTransaction(transaction);
        if (savedTransaction && savedTransaction.id) {
            if (!debt.transactionIds) debt.transactionIds = [];
            debt.transactionIds.push(savedTransaction.id);
            if (periodToPay) periodToPay.transactionIds.push(savedTransaction.id);
            saveDebts(allDebts);
        }
        
        generatePeriodsForDebt(debt);
        
        renderDebts();
        showToast(`Погашено ${payAmount.toFixed(2)} ₽`, 'success');
        document.dispatchEvent(new Event('transaction-added'));
        document.dispatchEvent(new Event('debt-updated'));
        
        if (debt.paidAmount >= debt.amount) {
            const shouldArchive = !debt.repeatEnabled || debt.repeatType === 'none' || (debt.lastRepeatDateEnd && new Date(debt.lastRepeatDateEnd) <= new Date());
            if (shouldArchive) {
                debt.isArchived = true; debt.archivedAt = new Date().toISOString();
                saveDebts(allDebts);
                renderDebts();
                showToast(`Долг "${debt.title}" полностью погашен и перемещен в архив! 🎉`, 'success');
            } else {
                showToast(`Долг "${debt.title}" полностью погашен! 🎉`, 'success');
            }
        }
    });
}

// ===== ОПЛАТА ТЕКУЩЕГО ПЕРИОДА =====
function payCurrentPeriod(debtId) {
    const allDebts = getDebts();
    const debtIndex = allDebts.findIndex(d => d.id === debtId);
    if (debtIndex === -1) { showToast('Долг не найден', 'error'); return; }
    const debt = allDebts[debtIndex];
    
    if (!debt.repeatEnabled || debt.repeatType === 'none') {
        showToast('Это не повторяющийся долг', 'error');
        return;
    }
    
    const periods = (debt.periods || []).sort((a, b) => new Date(a.dueDate + 'T00:00:00') - new Date(b.dueDate + 'T00:00:00'));
    const nextPeriod = periods.find(p => (p.paidAmount || 0) < p.amount);
    if (!nextPeriod) {
        showToast('Нет неоплаченных периодов', 'info');
        return;
    }
    
    const payAmount = nextPeriod.amount - (nextPeriod.paidAmount || 0);
    if (payAmount <= 0) {
        showToast('Сумма оплаты некорректна', 'error');
        return;
    }
    
    if (!confirm(`Оплатить период от ${formatDate(nextPeriod.dueDate)} на сумму ${payAmount.toFixed(2)} ₽?`)) return;
    
    const category = storageInstance.getCategory(debt.categoryId);
    const subcategory = debt.subcategoryId ? storageInstance.getCategory(debt.subcategoryId) : null;
    const transaction = {
        type: 'expense',
        amount: payAmount,
        category: debt.categoryId,
        categoryName: category?.name || 'Погашение долга',
        subcategoryId: debt.subcategoryId || null,
        subcategoryName: subcategory?.name || '',
        date: new Date().toISOString().split('T')[0],
        description: `Оплата периода долга: ${debt.title}`,
        comment: `Оплата периода от ${formatDate(nextPeriod.dueDate)}`,
        photo: '',
        isDebtPayment: true
    };
    
    const savedTransaction = storageInstance.addTransaction(transaction);
    if (!savedTransaction) {
        showToast('Ошибка при создании транзакции', 'error');
        return;
    }
    
    nextPeriod.paidAmount = (nextPeriod.paidAmount || 0) + payAmount;
    nextPeriod.paymentDate = transaction.date;
    if (!nextPeriod.transactionIds) nextPeriod.transactionIds = [];
    nextPeriod.transactionIds.push(savedTransaction.id);
    
    debt.paidAmount = (debt.paidAmount || 0) + payAmount;
    if (!debt.transactionIds) debt.transactionIds = [];
    debt.transactionIds.push(savedTransaction.id);
    
    generatePeriodsForDebt(debt);
    
    const allPaid = debt.periods.every(p => (p.paidAmount || 0) >= p.amount);
    if (allPaid) {
        if (!debt.repeatEnabled || debt.repeatType === 'none' || (debt.lastRepeatDateEnd && new Date(debt.lastRepeatDateEnd) < new Date())) {
            debt.isArchived = true;
            debt.archivedAt = new Date().toISOString();
            showToast('Долг полностью погашен и перемещен в архив!', 'success');
        } else {
            showToast('Долг полностью погашен!', 'success');
        }
    } else {
        showToast(`Период от ${formatDate(nextPeriod.dueDate)} оплачен`, 'success');
    }
    
    saveDebts(allDebts);
    renderDebts();
    populateCategoryFilter();
    document.dispatchEvent(new Event('debt-updated'));
    window.app?.refreshHeader?.();
    document.dispatchEvent(new Event('transaction-added'));
}

// ===== ВОЗВРАТ ДОЛГА =====
function restoreDebt(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    const isFromArchive = debt.isArchived === true;
    if (!confirm(isFromArchive ? `Вернуть долг "${debt.title}" из архива в активные?` : `Вернуть долг "${debt.title}" в активные?`)) return;
    const index = allDebts.findIndex(d => d.id === id);
    if (index === -1) { showToast('Долг не найден', 'error'); return; }
    if (isFromArchive && debt.transactionIds && debt.transactionIds.length > 0) {
        let deletedCount = 0;
        debt.transactionIds.forEach(transactionId => {
            const transaction = storageInstance.getTransaction(transactionId);
            if (transaction) { storageInstance.deleteTransaction(transactionId); deletedCount++; }
        });
        if (deletedCount > 0) showToast(`Удалено ${deletedCount} транзакций`, 'info');
    }
    allDebts[index].isArchived = false;
    delete allDebts[index].archivedAt;
    if (isFromArchive) {
        allDebts[index].paidAmount = 0;
        allDebts[index].transactionIds = [];
        if (allDebts[index].periods) allDebts[index].periods.forEach(p => { p.paidAmount = 0; p.transactionIds = []; p.paymentDate = ''; });
    }
    allDebts[index].isOverdue = false;
    delete allDebts[index].lastPaymentDate;
    saveDebts(allDebts);
    renderDebts();
    populateCategoryFilter();
    document.dispatchEvent(new Event('debt-updated'));
    showToast(`Долг "${debt.title}" возвращен в активные`, 'success');
    if (isFromArchive) document.dispatchEvent(new Event('transaction-deleted'));
}

// ===== ОБНУЛЕНИЕ ДОЛГА =====
function resetDebt(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    if (!confirm(`Обнулить долг "${debt.title}"? Сумма погашения будет сброшена, но история платежей (транзакции) останется.`)) return;
    debt.paidAmount = 0;
    debt.transactionIds = [];
    debt.isOverdue = false;
    delete debt.archivedAt;
    delete debt.lastPaymentDate;
    if (debt.periods) debt.periods.forEach(p => { p.paidAmount = 0; p.transactionIds = []; p.paymentDate = ''; });
    saveDebts(allDebts);
    renderDebts();
    populateCategoryFilter();
    document.dispatchEvent(new Event('debt-updated'));
    showToast('Долг обнулен', 'success');
}

// ===== УДАЛЕНИЕ ДОЛГА =====
function deleteDebt(id) {
    const allDebts = getDebts();
    const debt = allDebts.find(d => d.id === id);
    if (!debt) return;
    let message = `Удалить долг "${debt.title}"?`;
    if (debt.transactionIds && debt.transactionIds.length > 0) message += `\n\nСвязано транзакций: ${debt.transactionIds.length}. Они также будут удалены.`;
    if (confirm(message)) {
        if (debt.transactionIds) debt.transactionIds.forEach(transactionId => { const t = storageInstance.getTransaction(transactionId); if (t) storageInstance.deleteTransaction(transactionId); });
        if (debt.periods) debt.periods.forEach(p => { if (p.transactionIds) p.transactionIds.forEach(transactionId => { const t = storageInstance.getTransaction(transactionId); if (t) storageInstance.deleteTransaction(transactionId); }); });
        const newDebts = allDebts.filter(d => d.id !== id);
        saveDebts(newDebts);
        renderDebts();
        populateCategoryFilter();
        document.dispatchEvent(new Event('debt-updated'));
        showToast('Долг удален', 'success');
        document.dispatchEvent(new Event('transaction-deleted'));
    }
}

// ===== РАБОТА С ПЕРИОДАМИ =====
function openAddPeriodModal(parentId) {
    const allDebts = getDebts();
    const parentDebt = allDebts.find(d => d.id === parentId);
    if (!parentDebt) return;
    const today = new Date().toISOString().split('T')[0];
    openModal('Добавить период', `
        <form id="period-form">
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата периода *</label><input name="date" type="date" value="${today}" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма *</label><input name="amount" type="number" step="0.01" placeholder="Сумма периода" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма погашения</label><input name="paidAmount" type="number" step="0.01" value="0" min="0" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата оплаты</label><input name="payDate" type="date" placeholder="Дата оплаты" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий</label><textarea name="comment" placeholder="Комментарий к периоду" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:40px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);"></textarea></div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Сохранить</button>
        </form>
    `, (formData) => {
        const amount = parseFloat(formData.amount);
        if (amount <= 0) { showToast('Сумма должна быть положительной', 'error'); return; }
        const paidAmount = parseFloat(formData.paidAmount) || 0;
        if (paidAmount > amount) { showToast('Погашено не может быть больше суммы', 'error'); return; }
        const newPeriod = { id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6), amount: amount, paidAmount: paidAmount, dueDate: formData.date || today, comment: formData.comment || '', paymentDate: formData.payDate || '', transactionIds: [] };
        if (!parentDebt.periods) parentDebt.periods = [];
        parentDebt.periods.push(newPeriod);
        parentDebt.amount = parentDebt.periods.reduce((sum, p) => sum + p.amount, 0);
        parentDebt.paidAmount = parentDebt.periods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        const debts = getDebts(); const index = debts.findIndex(d => d.id === parentId); debts[index] = parentDebt; saveDebts(debts);
        renderDebts();
        showToast('Период добавлен', 'success');
    });
}

function openEditPeriodModal(id, parentId) {
    const allDebts = getDebts();
    const parentDebt = allDebts.find(d => d.id === parentId);
    if (!parentDebt) return;
    const period = parentDebt.periods?.find(p => p.id === id);
    if (!period) return;
    const today = new Date().toISOString().split('T')[0];
    openModal('Редактировать период', `
        <form id="period-form">
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата периода *</label><input name="date" type="date" value="${period.dueDate || today}" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма *</label><input name="amount" type="number" step="0.01" value="${period.amount}" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Сумма погашения</label><input name="paidAmount" type="number" step="0.01" value="${period.paidAmount || 0}" min="0" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Дата оплаты</label><input name="payDate" type="date" value="${period.paymentDate || ''}" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;"></div>
            <div style="margin-bottom:12px;"><label style="display:block;font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:4px;">Комментарий</label><textarea name="comment" placeholder="Комментарий к периоду" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);resize:vertical;min-height:40px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);">${period.comment || ''}</textarea></div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">Обновить</button>
        </form>
    `, (formData) => {
        const amount = parseFloat(formData.amount);
        if (amount <= 0) { showToast('Сумма должна быть положительной', 'error'); return; }
        const paidAmount = parseFloat(formData.paidAmount) || 0;
        if (paidAmount > amount) { showToast('Погашено не может быть больше суммы', 'error'); return; }
        const periodIndex = parentDebt.periods.findIndex(p => p.id === id);
        if (periodIndex !== -1) {
            parentDebt.periods[periodIndex] = { ...parentDebt.periods[periodIndex], amount: amount, paidAmount: paidAmount, dueDate: formData.date || period.dueDate, comment: formData.comment || '', paymentDate: formData.payDate || '' };
            parentDebt.amount = parentDebt.periods.reduce((sum, p) => sum + p.amount, 0);
            parentDebt.paidAmount = parentDebt.periods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
            const debts = getDebts(); const index = debts.findIndex(d => d.id === parentId); debts[index] = parentDebt; saveDebts(debts);
            renderDebts();
            showToast('Период обновлён', 'success');
        }
    });
}

function deletePeriod(id, parentId) {
    const allDebts = getDebts();
    const parentDebt = allDebts.find(d => d.id === parentId);
    if (!parentDebt) return;
    const periodIndex = (parentDebt.periods || []).findIndex(p => p.id === id);
    if (periodIndex === -1) return;
    const period = parentDebt.periods[periodIndex];
    if (!confirm(`Удалить период от ${period.dueDate ? formatDate(period.dueDate) : 'без даты'}?`)) return;
    if (period.transactionIds) period.transactionIds.forEach(transactionId => { const t = storageInstance.getTransaction(transactionId); if (t) storageInstance.deleteTransaction(transactionId); });
    parentDebt.periods.splice(periodIndex, 1);
    parentDebt.amount = parentDebt.periods.reduce((sum, p) => sum + p.amount, 0);
    parentDebt.paidAmount = parentDebt.periods.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
    const debts = getDebts(); const index = debts.findIndex(d => d.id === parentId); debts[index] = parentDebt; saveDebts(debts);
    renderDebts();
    showToast('Период удалён', 'success');
    document.dispatchEvent(new Event('transaction-deleted'));
}