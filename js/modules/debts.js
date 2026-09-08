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
    if (repeatCheckInterval) clearInterval(repeatCheckInterval);
    const refresh = () => {
        syncAllAutomaticPeriods();
        updateDebtStatuses();
        archiveCompletedDebts();
    };
    repeatCheckInterval = setInterval(refresh, 60 * 1000);
    setTimeout(refresh, 1000);
}

// ===== МИГРАЦИЯ =====
function migrateExistingDebts() {
    const allDebts = getDebts();
    let needsSave = false;
    const children = allDebts.filter(d => d.parentDebtId);

    children.forEach(child => {
        const parent = allDebts.find(d => d.id === child.parentDebtId);
        if (!parent) return;
        parent.periods = Array.isArray(parent.periods) ? parent.periods : [];
        if (!parent.periods.some(p => p.id === child.id)) {
            parent.periods.push({
                id: child.id,
                amount: Number(child.amount || 0),
                paidAmount: Number(child.paidAmount || 0),
                dueDate: child.dueDate || '',
                comment: child.comment || '',
                paymentDate: child.paymentDate || '',
                isOverdue: Boolean(child.isOverdue),
                transactionIds: child.transactionIds || []
            });
        }
        needsSave = true;
    });

    const debts = allDebts.filter(d => !d.parentDebtId);
    debts.forEach(debt => {
        debt.periods = Array.isArray(debt.periods) ? debt.periods : [];
        debt.archivedPeriods = Array.isArray(debt.archivedPeriods) ? debt.archivedPeriods : [];
        if (debt.repeatType === 'manual') {
            debt.manualSchedule = Array.isArray(debt.manualSchedule) && debt.manualSchedule.length
                ? debt.manualSchedule
                : debt.periods.map(p => ({ id: p.id, dueDate: p.dueDate || '', amount: Number(p.amount || 0), comment: p.comment || '' }));
        }
        debt.transactionIds = Array.isArray(debt.transactionIds) ? debt.transactionIds : [];
        debt.baseAmount = Number(debt.baseAmount ?? debt.amount ?? 0);
        debt.amount = Number(debt.amount || debt.baseAmount || 0);
        debt.paidAmount = Number(debt.paidAmount || 0);
        debt.isArchived = Boolean(debt.isArchived);
        debt.isOverdue = Boolean(debt.isOverdue);
        debt.showOnDashboard = debt.showOnDashboard !== false;
        if (debt.periods.length) recalcDebtFromPeriods(debt);
        // Persist normalization/manual schedule metadata immediately.
        needsSave = true;
    });

    if (needsSave || children.length) saveDebts(debts);
}

function makeId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addInterval(date, repeatType, interval = 1) {
    const result = new Date(date);
    if (repeatType === 'daily') result.setDate(result.getDate() + interval);
    else if (repeatType === 'weekly') result.setDate(result.getDate() + interval * 7);
    else if (repeatType === 'monthly') result.setMonth(result.getMonth() + interval);
    else if (repeatType === 'yearly') result.setFullYear(result.getFullYear() + interval);
    else return null;
    return result;
}

function isIndefiniteAutomaticDebt(debt) {
    return Boolean(debt.repeatEnabled && !['none', 'manual'].includes(debt.repeatType) && !debt.lastRepeatDateEnd);
}

function getScheduleStart(debt) {
    const start = debt.dueDate
        ? new Date(`${debt.dueDate}T00:00:00`)
        : new Date(debt.createdAt || Date.now());
    start.setHours(0, 0, 0, 0);
    return isNaN(start.getTime()) ? null : start;
}

// For an endless recurring debt we keep only the relevant current occurrence
// and one nearest future occurrence. We do not materialize a year of future debt.
function getIndefiniteWindowDates(debt) {
    const start = getScheduleStart(debt);
    if (!start) return [];
    const interval = Math.max(1, Number(debt.repeatInterval || 1));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start > today) return [toDateString(start)];

    let current = new Date(start);
    let next = addInterval(current, debt.repeatType, interval);
    let guard = 0;
    while (next && next <= today && guard++ < 5000) {
        current = next;
        next = addInterval(current, debt.repeatType, interval);
    }

    const dates = [toDateString(current)];
    if (next) dates.push(toDateString(next));
    return [...new Set(dates)];
}

function getAutomaticSchedule(debt) {
    if (!debt.repeatEnabled || ['none', 'manual'].includes(debt.repeatType)) return [];
    if (isIndefiniteAutomaticDebt(debt)) return getIndefiniteWindowDates(debt);

    const start = getScheduleStart(debt);
    if (!start) return [];
    const end = new Date(`${debt.lastRepeatDateEnd}T00:00:00`);
    if (isNaN(end.getTime())) return [];

    const dates = [];
    let cursor = new Date(start);
    const interval = Math.max(1, Number(debt.repeatInterval || 1));
    let guard = 0;
    while (cursor <= end && guard++ < 5000) {
        dates.push(toDateString(cursor));
        cursor = addInterval(cursor, debt.repeatType, interval);
        if (!cursor) break;
    }
    return dates;
}

function createPeriod(debt, dueDate, overrides = {}) {
    return {
        id: overrides.id || makeId('period'),
        amount: Number(overrides.amount ?? debt.baseAmount ?? debt.amount ?? 0),
        paidAmount: Number(overrides.paidAmount || 0),
        dueDate: dueDate || overrides.dueDate || '',
        comment: overrides.comment ?? 'Ожидает оплаты',
        paymentDate: overrides.paymentDate || '',
        isOverdue: Boolean(overrides.isOverdue),
        transactionIds: Array.isArray(overrides.transactionIds) ? overrides.transactionIds : []
    };
}

function recalcDebtFromPeriods(debt) {
    if (!Array.isArray(debt.periods) || debt.periods.length === 0) {
        debt.amount = Number(debt.baseAmount || debt.amount || 0);
        debt.paidAmount = Math.min(Number(debt.paidAmount || 0), debt.amount);
        return;
    }
    debt.periods.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    debt.amount = debt.periods.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    debt.paidAmount = debt.periods.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);
}

// Non-destructive background sync. Existing periods are never overwritten here.
function archivePaidPeriodsForIndefiniteDebt(debt) {
    if (!isIndefiniteAutomaticDebt(debt) || !Array.isArray(debt.periods) || !debt.periods.length) return false;
    debt.archivedPeriods = Array.isArray(debt.archivedPeriods) ? debt.archivedPeriods : [];
    const paid = debt.periods.filter(p => Number(p.paidAmount || 0) >= Number(p.amount || 0));
    if (!paid.length) return false;

    const archivedIds = new Set(debt.archivedPeriods.map(p => p.id));
    paid.forEach(period => {
        if (!archivedIds.has(period.id)) {
            debt.archivedPeriods.push({ ...period, archivedAt: new Date().toISOString() });
            archivedIds.add(period.id);
        }
    });
    const paidIds = new Set(paid.map(p => p.id));
    debt.periods = debt.periods.filter(p => !paidIds.has(p.id));
    return true;
}

function ensureManualScheduleIntegrity(debt) {
    if (debt.repeatType !== 'manual') return false;
    debt.periods = Array.isArray(debt.periods) ? debt.periods : [];
    debt.manualSchedule = Array.isArray(debt.manualSchedule) ? debt.manualSchedule : [];

    if (!debt.manualSchedule.length && debt.periods.length) {
        debt.manualSchedule = debt.periods.map(p => ({ id: p.id, dueDate: p.dueDate || '', amount: Number(p.amount || 0), comment: p.comment || '' }));
        return true;
    }

    const currentIds = new Set(debt.periods.map(p => p.id));
    let changed = false;
    debt.manualSchedule.forEach(item => {
        if (!item?.id || currentIds.has(item.id)) return;
        debt.periods.push(createPeriod(debt, item.dueDate, {
            id: item.id,
            amount: Number(item.amount || 0),
            comment: item.comment || 'Ожидает оплаты'
        }));
        currentIds.add(item.id);
        changed = true;
    });
    if (changed) recalcDebtFromPeriods(debt);
    return changed;
}

function updateManualScheduleSnapshot(debt) {
    if (debt.repeatType !== 'manual') return;
    debt.manualSchedule = (debt.periods || []).map(p => ({
        id: p.id,
        dueDate: p.dueDate || '',
        amount: Number(p.amount || 0),
        comment: p.comment || ''
    }));
}

// Non-destructive background sync. Manual periods are never touched.
function syncAllAutomaticPeriods() {
    const debts = getDebts();
    let changed = false;
    debts.forEach(debt => {
        if (debt.isArchived || !debt.repeatEnabled || debt.repeatType === 'none') return;
        if (debt.repeatType === 'manual') {
            if (ensureManualScheduleIntegrity(debt)) changed = true;
            return;
        }
        debt.periods = Array.isArray(debt.periods) ? debt.periods : [];
        debt.archivedPeriods = Array.isArray(debt.archivedPeriods) ? debt.archivedPeriods : [];

        if (archivePaidPeriodsForIndefiniteDebt(debt)) changed = true;

        const expected = getAutomaticSchedule(debt);
        const knownDates = new Set([
            ...debt.periods.map(p => p.dueDate),
            ...debt.archivedPeriods.map(p => p.dueDate)
        ].filter(Boolean));

        expected.forEach(date => {
            if (!knownDates.has(date)) {
                debt.periods.push(createPeriod(debt, date));
                knownDates.add(date);
                changed = true;
            }
        });

        // Endless schedules keep unpaid/overdue periods plus only one future period.
        if (isIndefiniteAutomaticDebt(debt)) {
            const todayStr = toDateString(new Date());
            const future = debt.periods
                .filter(p => p.dueDate > todayStr && Number(p.paidAmount || 0) < Number(p.amount || 0))
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
            const keepFutureId = future[0]?.id;
            const extraFuture = new Set(future.slice(1).map(p => p.id));
            if (extraFuture.size) {
                debt.periods = debt.periods.filter(p => !extraFuture.has(p.id));
                changed = true;
            }
        }
        recalcDebtFromPeriods(debt);
    });
    if (changed) saveDebts(debts);
}

// Explicit debt edit: update schedule fields while preserving payment/history by period order.
function rebuildPeriodsForEditedDebt(debt, oldPeriods = []) {
    if (!debt.repeatEnabled || debt.repeatType === 'none') {
        debt.periods = [];
        debt.amount = Number(debt.baseAmount || 0);
        debt.paidAmount = Math.min(Number(debt.paidAmount || 0), debt.amount);
        return;
    }
    if (debt.repeatType === 'manual') {
        // Manual schedule is authoritative: never regenerate or truncate it in background/edit flows.
        debt.periods = oldPeriods.map(p => ({ ...p }));
        debt.periods.forEach(p => {
            if (!Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0) p.amount = Number(debt.baseAmount || 0);
        });
        recalcDebtFromPeriods(debt);
        return;
    }

    const dates = getAutomaticSchedule(debt);
    const previous = [...oldPeriods].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    debt.periods = dates.map((date, index) => {
        const old = previous[index];
        if (!old) return createPeriod(debt, date);
        return createPeriod(debt, date, {
            ...old,
            amount: Number(debt.baseAmount || 0),
            paidAmount: Math.min(Number(old.paidAmount || 0), Number(debt.baseAmount || 0)),
            dueDate: date
        });
    });
    recalcDebtFromPeriods(debt);
}

// Backward-compatible wrapper used by init/add.
function generateAllPeriods() { syncAllAutomaticPeriods(); }

// ===== АРХИВАЦИЯ =====
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
        
        if (!(debt.paidAmount >= debt.amount) && debt.dueDate && !debt.repeatEnabled) {
            const dueDate = new Date(debt.dueDate + 'T00:00:00');
            
            if (dueDate <= today && !debt.isOverdue) {
                debt.isOverdue = true;
                updated = true;
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
        window.app?.refreshHeader?.();
    }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
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
    return storageInstance.getData().debts || [];
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
    
    let html = `<button class="debt-category-filter-btn active" data-category="all">Все</button>`;
    
    parentCategories.forEach(cat => {
        const color = cat.color || '#666666';
        const count = allDebts.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            return category?.parentId === cat.id || debt.categoryId === cat.id;
        }).length;
        
        if (count > 0) {
            html += `<button class="debt-category-filter-btn" data-category="${cat.id}" data-color="${color}" style="color:${color};">${cat.name}</button>`;
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

// ===== ОТОБРАЖЕНИЕ ДОЛГОВ (С ИСПРАВЛЕННОЙ ИСТОРИЕЙ И ДЕЛЕГИРОВАНИЕМ) =====
function renderDebts() {
    const allDebts = getDebts();
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense');
    
    let filtered = allDebts.filter(d => !d.parentDebtId);
    
    if (currentFilter === 'archive') {
        filtered = filtered.filter(d => d.isArchived === true);
    } else {
        filtered = filtered.filter(d => d.isArchived !== true);
        if (currentFilter === 'active') filtered = filtered.filter(d => d.paidAmount < d.amount);
        else if (currentFilter === 'paid') filtered = filtered.filter(d => d.paidAmount >= d.amount && (!d.repeatEnabled || d.repeatType === 'none'));
        else if (currentFilter === 'month') filtered = filtered.filter(debt => isDebtInCurrentMonth(debt));
    }

    if (currentCategoryFilter !== 'all') {
        filtered = filtered.filter(debt => {
            const category = categories.find(c => c.id === debt.categoryId);
            const isParentCategory = !category?.parentId && debt.categoryId === currentCategoryFilter;
            const isSubCategory = category?.parentId === currentCategoryFilter;
            return isParentCategory || isSubCategory;
        });
    }

    if (currentFilter !== 'archive') {
        filtered.sort((a, b) => {
            const getDueDate = (debt) => {
                if ((debt.paidAmount || 0) >= debt.amount && !(debt.repeatEnabled && debt.repeatType !== 'none')) return null;
                if (debt.repeatEnabled && debt.repeatType !== 'none') {
                    const periods = (debt.periods || []).sort((x, y) => new Date(x.dueDate) - new Date(y.dueDate));
                    const next = periods.find(p => (p.paidAmount || 0) < p.amount);
                    return next ? new Date(next.dueDate + 'T00:00:00') : null;
                } else {
                    return debt.dueDate ? new Date(debt.dueDate + 'T00:00:00') : null;
                }
            };

            const aDate = getDueDate(a);
            const bDate = getDueDate(b);
            const aIsUnpaid = aDate !== null && (a.paidAmount || 0) < a.amount;
            const bIsUnpaid = bDate !== null && (b.paidAmount || 0) < b.amount;

            if (aIsUnpaid && bIsUnpaid) {
                if (aDate && bDate) return aDate - bDate;
                if (aDate) return -1;
                if (bDate) return 1;
                return 0;
            }
            if (aIsUnpaid && !bIsUnpaid) return -1;
            if (!aIsUnpaid && bIsUnpaid) return 1;
            return 0;
        });
    } else {
        filtered.sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
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
        container.innerHTML = `<div class="debt-card" style="grid-column:1/-1;min-height:200px;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;">
            <div>${emptyMessage}</div>
            ${currentFilter !== 'archive' ? '<button class="btn btn-primary" id="add-first-debt">+ Добавить долг</button>' : ''}
        </div>`;
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
        
        if (isRepeat) {
            const sortedPeriods = [...periods].sort((a, b) => new Date(a.dueDate + 'T00:00:00') - new Date(b.dueDate + 'T00:00:00'));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const currentOrOverdue = sortedPeriods.find(p => {
                const dueDate = new Date(p.dueDate + 'T00:00:00');
                return dueDate <= today;
            });
            
            let nextAfterCurrent = null;
            if (currentOrOverdue) {
                const currentIndex = sortedPeriods.indexOf(currentOrOverdue);
                nextAfterCurrent = sortedPeriods[currentIndex + 1] || null;
            } else {
                nextAfterCurrent = sortedPeriods[0] || null;
            }
            
            if (currentOrOverdue) {
                if ((currentOrOverdue.paidAmount || 0) < currentOrOverdue.amount) {
                    periodToDisplay = currentOrOverdue;
                } else {
                    periodToDisplay = nextAfterCurrent || currentOrOverdue;
                }
            } else {
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

        // Компактная история периодов
        const historyHtml = (periods || []).map(period => {
            const periodRemaining = Math.max(period.amount - (period.paidAmount || 0), 0);
            const periodStatus = period.paidAmount >= period.amount ? '✓' : (period.isOverdue ? '🔥' : '○');
            const paidDate = period.paymentDate ? formatDate(period.paymentDate) : '';
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-text-secondary);">
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${period.dueDate ? formatDate(period.dueDate) : 'Без даты'}</span>
                    <span style="margin-left:4px;font-weight:600;color:${period.paidAmount >= period.amount ? '#22C55E' : '#EF4444'};">${period.amount.toFixed(2)} ₽</span>
                    <span style="margin-left:4px;">Оплачено: ${(period.paidAmount || 0).toFixed(2)} ₽</span>
                    <span style="margin-left:4px;color:${periodRemaining > 0 ? '#EF4444' : '#22C55E'};">Осталось: ${periodRemaining.toFixed(2)} ₽</span>
                    ${paidDate ? `<span style="margin-left:4px;">Дата: ${paidDate}</span>` : ''}
                    <span style="margin-left:4px;">${periodStatus}</span>
                    <span style="margin-left:4px;display:inline-flex;gap:2px;">
                        <button class="btn-edit-period" data-id="${period.id}" data-parent-id="${debt.id}" style="padding:1px 4px;border:none;background:transparent;color:var(--color-text-muted);font-size:10px;cursor:pointer;border-radius:var(--radius-sm);transition:var(--transition);">✎</button>
                        <button class="btn-delete-period" data-id="${period.id}" data-parent-id="${debt.id}" style="padding:1px 4px;border:none;background:transparent;color:var(--color-text-muted);font-size:10px;cursor:pointer;border-radius:var(--radius-sm);transition:var(--transition);">✕</button>
                    </span>
                </div>
            `;
        }).join('');

        return `
            <div class="debt-card" data-debt-id="${debt.id}" style="${isOverdue ? 'border-color:#EF4444;box-shadow:0 0 10px rgba(239,68,68,0.1);' : ''}${isArchived ? 'opacity:0.7;background:var(--color-bg-secondary);' : ''}">
                <div class="debt-header">
                    <span class="debt-title" style="color:${isOverdue ? '#EF4444' : color};">${debt.title}</span>
                    <span class="debt-status ${status}">${statusLabels[status]}</span>
                </div>
                <div class="debt-category">${categoryName} ${repeatLabel ? '🔄 ' + repeatLabel : ''}</div>
                <div class="debt-amount">
                    ${displayAmount.toFixed(2)} ₽
                    ${debt.paidAmount > 0 ? `<span class="paid-amount">(погашено ${debt.paidAmount.toFixed(2)} ₽)</span>` : ''}
                </div>
                <div class="debt-progress">
                    <div class="progress-track">
                        <div class="progress-fill" style="width:${paidPercent}%;background:${isPaid ? '#22C55E' : (isOverdue ? '#EF4444' : color)};"></div>
                    </div>
                    <span class="progress-text">${paidPercent.toFixed(0)}%</span>
                </div>
                <div class="debt-meta">
                    <span style="${isOverdue ? 'color:#EF4444;font-weight:bold;' : ''}">${periodToDisplay?.dueDate ? (isOverdue ? 'Срок истек: ' : 'До: ') + formatDate(periodToDisplay.dueDate) : (debt.dueDate ? 'До: ' + formatDate(debt.dueDate) : 'Без срока')}</span>
                    <span>${periodToDisplay?.comment || debt.comment || ''}</span>
                </div>
                <div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;">
                    <span>Создан: ${debt.createdAt ? formatDate(debt.createdAt.slice(0, 10)) : '—'}</span>
                </div>
                ${archivedDate ? `<div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;"><span>${archivedDate}</span></div>` : ''}
                ${debt.repeatEnabled && debt.lastRepeatDate ? `<div class="debt-meta" style="font-size:10px;color:var(--color-text-muted);border-top:none;padding-top:0;"><span>Последнее обновление: ${formatDate(debt.lastRepeatDate)}</span>${debt.lastRepeatDateEnd ? `<span>До: ${formatDate(debt.lastRepeatDateEnd)}</span>` : ''}</div>` : ''}
                <div class="debt-actions">
                    ${isArchived ? `
                        <button class="btn-restore-debt" data-id="${debt.id}">↩ Вернуть</button>
                        <button class="btn-delete-debt" data-id="${debt.id}">✕</button>
                    ` : `
                        <button class="btn-toggle-visibility" data-id="${debt.id}" style="${showOnDashboard ? '' : 'opacity:0.6;'}">${showOnDashboard ? 'Скрыть' : 'Показать'}</button>
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
                ${hasTransactions ? `<div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;border-top:1px solid var(--color-border);padding-top:4px;">Связано транзакций: ${debt.transactionIds.length}</div>` : ''}
                ${isRepeat ? `
                    <div class="debt-repeat-info" style="margin-top:8px;border-top:1px solid var(--color-border);padding-top:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-secondary);margin-bottom:4px;">
                            <span>Периодов: ${periods.length}</span>
                            <span>Всего: ${totalAll.toFixed(2)} ₽</span>
                            <span>Оплачено: ${totalPaidAll.toFixed(2)} ₽</span>
                            <span>Осталось: ${totalRemainingAll.toFixed(2)} ₽</span>
                        </div>
                        <div style="display:flex;gap:4px;margin-bottom:6px;">
                            <button class="btn-add-period" data-id="${debt.id}" style="padding:2px 8px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-secondary);border-radius:var(--radius-sm);font-family:var(--font-family);font-size:10px;cursor:pointer;transition:var(--transition);">+ Добавить период</button>
                            <button class="btn-toggle-history" data-id="${debt.id}" style="padding:2px 8px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-secondary);border-radius:var(--radius-sm);font-family:var(--font-family);font-size:10px;cursor:pointer;transition:var(--transition);">Показать историю</button>
                        </div>
                        <div class="repeat-history" style="display:none;margin-top:8px;background:var(--color-bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                            ${historyHtml}
                            ${periods.length === 0 ? '<div style="font-size:10px;color:var(--color-text-muted);">Ещё нет созданных периодов</div>' : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // Делегирование событий для всех кнопок внутри контейнера
    container.onclick = (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const id = target.dataset.id;
        const parentId = target.dataset.parentId;

        if (target.classList.contains('btn-toggle-visibility')) toggleDebtVisibility(id);
        else if (target.classList.contains('btn-pay-full')) openPayDebtModal(id, 'full');
        else if (target.classList.contains('btn-pay-partial')) openPayDebtModal(id, 'partial');
        else if (target.classList.contains('btn-pay-current-period')) payCurrentPeriod(id);
        else if (target.classList.contains('btn-restore-debt')) restoreDebt(id);
        else if (target.classList.contains('btn-archive-debt')) archiveDebt(id);
        else if (target.classList.contains('btn-reset-debt')) resetDebt(id);
        else if (target.classList.contains('btn-edit-debt')) openEditDebtModal(id);
        else if (target.classList.contains('btn-delete-debt')) deleteDebt(id);
        else if (target.classList.contains('btn-add-period')) openAddPeriodModal(id);
        else if (target.classList.contains('btn-toggle-history')) {
            const card = target.closest('.debt-card');
            const historyBlock = card.querySelector('.repeat-history');
            const isHidden = historyBlock.style.display === 'none';
            historyBlock.style.display = isHidden ? 'block' : 'none';
            target.textContent = isHidden ? 'Скрыть историю' : 'Показать историю';
        }
        else if (target.classList.contains('btn-edit-period')) openEditPeriodModal(id, parentId);
        else if (target.classList.contains('btn-delete-period')) deletePeriod(id, parentId);
    };
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
    const labels = { 'none': '', 'manual': 'Периоды вручную', 'daily': `Каждые ${interval || 1} дн.`, 'weekly': `Каждые ${interval || 1} нед.`, 'monthly': `Каждые ${interval || 1} мес.`, 'yearly': `Каждые ${interval || 1} год.` };
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

// ===== ФОРМЫ ДОЛГА =====
function fieldStyle(extra = '') {
    return `width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);font-size:var(--font-size-sm);box-sizing:border-box;${extra}`;
}

function buildManualPeriodsEditor(debt, escapeValue, isEdit) {
    if (isEdit) {
        return `<div id="manual-periods-editor" style="display:${debt.repeatType === 'manual' ? 'block' : 'none'};padding:10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-secondary);">
            <div style="font-size:12px;color:var(--color-text-secondary);">Периоды этого долга уже созданы. Их дату и сумму можно менять кнопкой редактирования каждого периода в карточке долга.</div>
        </div>`;
    }

    const initialPeriods = Array.isArray(debt.periods) && debt.periods.length
        ? debt.periods
        : [{ dueDate: debt.dueDate || '', amount: debt.baseAmount || '', comment: '' }];

    const rows = initialPeriods.map((period, index) => `
        <div class="manual-period-row" style="display:grid;grid-template-columns:1.2fr 1fr auto;gap:8px;align-items:end;padding:8px 0;border-bottom:1px solid var(--color-border);">
            <label style="font-size:12px;">Дата<input class="manual-period-date" type="date" value="${escapeValue(period.dueDate || '')}" style="${fieldStyle('margin-top:4px;')}"></label>
            <label style="font-size:12px;">Сумма<input class="manual-period-amount" type="number" min="0.01" step="0.01" value="${escapeValue(period.amount ?? debt.baseAmount ?? '')}" style="${fieldStyle('margin-top:4px;')}"></label>
            <button type="button" class="btn-remove-manual-period" title="Удалить период" style="height:36px;padding:0 11px;border:1px solid var(--color-border);border-radius:6px;background:transparent;color:var(--color-text);cursor:pointer;">✕</button>
            <input class="manual-period-comment" type="text" placeholder="Комментарий к периоду" value="${escapeValue(period.comment && period.comment !== 'Ожидает оплаты' ? period.comment : '')}" style="${fieldStyle('grid-column:1 / -1;')}">
        </div>
    `).join('');

    return `<div id="manual-periods-editor" style="display:${debt.repeatType === 'manual' ? 'block' : 'none'};padding:10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-secondary);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
            <div>
                <div style="font-size:13px;font-weight:600;">Периоды и суммы</div>
                <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px;">Для каждого периода можно указать свою дату и сумму.</div>
            </div>
            <button type="button" id="btn-add-manual-period-row" style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg-card);color:var(--color-text);cursor:pointer;white-space:nowrap;">+ Период</button>
        </div>
        <div id="manual-periods-list">${rows}</div>
        <input type="hidden" name="manualPeriodsJson" id="manual-periods-json" value="[]">
    </div>`;
}

function buildDebtForm(debt = {}) {
    const categories = storageInstance.getCategories();
    const parents = categories.filter(c => c.type === 'expense' && !c.parentId);
    const selectedCategory = debt.categoryId || parents[0]?.id || '';
    const subcategories = categories.filter(c => c.type === 'expense' && c.parentId === selectedCategory);
    const repeatType = debt.repeatType || 'none';
    const isEdit = Boolean(debt.id);
    const value = (v = '') => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<form id="debt-form">
        <div style="display:grid;gap:12px;">
            <label>Название *<input name="title" required value="${value(debt.title)}" style="${fieldStyle('margin-top:4px;')}"></label>
            <label id="base-amount-label">Сумма за период *<input name="baseAmount" type="number" min="0.01" step="0.01" required value="${value(debt.baseAmount ?? debt.amount ?? '')}" style="${fieldStyle('margin-top:4px;')}"></label>
            ${isEdit ? `<label>Оплачено всего<input name="paidAmount" type="number" min="0" step="0.01" value="${value(debt.paidAmount || 0)}" style="${fieldStyle('margin-top:4px;')}"></label>` : ''}
            <label>Категория<select name="categoryId" id="debt-category-select" style="${fieldStyle('margin-top:4px;')}">${parents.map(c => `<option value="${c.id}" ${c.id === selectedCategory ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
            <label>Подкатегория<select name="subcategoryId" id="debt-subcategory-select" style="${fieldStyle('margin-top:4px;')}"><option value="">Без подкатегории</option>${subcategories.map(c => `<option value="${c.id}" ${c.id === debt.subcategoryId ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
            <label>Дата первой оплаты / срок<input name="dueDate" type="date" value="${value(debt.dueDate || '')}" style="${fieldStyle('margin-top:4px;')}"></label>
            <label>Периодичность<select name="repeatType" id="debt-repeat-type" style="${fieldStyle('margin-top:4px;')}">
                <option value="none" ${repeatType === 'none' ? 'selected' : ''}>Без повторения</option>
                <option value="manual" ${repeatType === 'manual' ? 'selected' : ''}>Указать периоды вручную</option>
                <option value="daily" ${repeatType === 'daily' ? 'selected' : ''}>Дни</option>
                <option value="weekly" ${repeatType === 'weekly' ? 'selected' : ''}>Недели</option>
                <option value="monthly" ${repeatType === 'monthly' ? 'selected' : ''}>Месяцы</option>
                <option value="yearly" ${repeatType === 'yearly' ? 'selected' : ''}>Годы</option>
            </select></label>
            <div id="repeat-options" style="display:${['none','manual'].includes(repeatType) ? 'none' : 'grid'};grid-template-columns:1fr 1fr;gap:12px;">
                <label>Интервал<input name="repeatInterval" type="number" min="1" step="1" value="${value(debt.repeatInterval || 1)}" style="${fieldStyle('margin-top:4px;')}"></label>
                <label>Повторять до<input name="repeatEndDate" type="date" value="${value(debt.lastRepeatDateEnd || '')}" style="${fieldStyle('margin-top:4px;')}"></label>
            </div>
            ${buildManualPeriodsEditor(debt, value, isEdit)}
            <label>Комментарий<textarea name="comment" style="${fieldStyle('margin-top:4px;min-height:60px;resize:vertical;')}">${value(debt.comment || '')}</textarea></label>
            ${isEdit ? `<label style="display:flex;gap:8px;align-items:center;"><input name="showOnDashboard" type="checkbox" value="true" ${debt.showOnDashboard !== false ? 'checked' : ''}> Показывать на главной</label>` : ''}
            
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">${isEdit ? 'Сохранить изменения' : 'Добавить долг'}</button>
        </div>
    </form>`;
}

function attachDebtFormListeners(modal) {
    const category = modal.querySelector('#debt-category-select');
    const subcategory = modal.querySelector('#debt-subcategory-select');
    const repeatType = modal.querySelector('#debt-repeat-type');
    const repeatOptions = modal.querySelector('#repeat-options');
    const manualEditor = modal.querySelector('#manual-periods-editor');
    const manualList = modal.querySelector('#manual-periods-list');
    const manualJson = modal.querySelector('#manual-periods-json');
    const baseAmountInput = modal.querySelector('[name="baseAmount"]');
    const baseAmountLabel = modal.querySelector('#base-amount-label');

    category?.addEventListener('change', () => {
        const subs = storageInstance.getCategories().filter(c => c.type === 'expense' && c.parentId === category.value);
        subcategory.innerHTML = '<option value="">Без подкатегории</option>' + subs.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    });

    const serializeManualPeriods = () => {
        if (!manualList || !manualJson) return;
        const periods = [...manualList.querySelectorAll('.manual-period-row')].map(row => ({
            dueDate: row.querySelector('.manual-period-date')?.value || '',
            amount: Number(row.querySelector('.manual-period-amount')?.value || 0),
            comment: row.querySelector('.manual-period-comment')?.value?.trim() || ''
        }));
        manualJson.value = JSON.stringify(periods);
    };

    const addManualRow = () => {
        if (!manualList) return;
        const row = document.createElement('div');
        row.className = 'manual-period-row';
        row.style.cssText = 'display:grid;grid-template-columns:1.2fr 1fr auto;gap:8px;align-items:end;padding:8px 0;border-bottom:1px solid var(--color-border);';
        row.innerHTML = `
            <label style="font-size:12px;">Дата<input class="manual-period-date" type="date" style="${fieldStyle('margin-top:4px;')}"></label>
            <label style="font-size:12px;">Сумма<input class="manual-period-amount" type="number" min="0.01" step="0.01" value="${baseAmountInput?.value || ''}" style="${fieldStyle('margin-top:4px;')}"></label>
            <button type="button" class="btn-remove-manual-period" title="Удалить период" style="height:36px;padding:0 11px;border:1px solid var(--color-border);border-radius:6px;background:transparent;color:var(--color-text);cursor:pointer;">✕</button>
            <input class="manual-period-comment" type="text" placeholder="Комментарий к периоду" style="${fieldStyle('grid-column:1 / -1;')}">
        `;
        manualList.appendChild(row);
        serializeManualPeriods();
    };

    modal.querySelector('#btn-add-manual-period-row')?.addEventListener('click', addManualRow);
    manualList?.addEventListener('click', event => {
        const button = event.target.closest('.btn-remove-manual-period');
        if (!button) return;
        if (manualList.querySelectorAll('.manual-period-row').length <= 1) {
            showToast('Нужен хотя бы один период', 'error');
            return;
        }
        button.closest('.manual-period-row')?.remove();
        serializeManualPeriods();
    });
    manualList?.addEventListener('input', serializeManualPeriods);
    manualList?.addEventListener('change', serializeManualPeriods);

    const updateRepeatUI = () => {
        const isManual = repeatType?.value === 'manual';
        if (repeatOptions) repeatOptions.style.display = ['none', 'manual'].includes(repeatType?.value) ? 'none' : 'grid';
        if (manualEditor) manualEditor.style.display = isManual ? 'block' : 'none';
        if (baseAmountLabel && manualList) baseAmountLabel.style.display = isManual ? 'none' : 'block';
        if (baseAmountInput && manualList) baseAmountInput.required = !isManual;
        if (isManual && manualList && !manualList.children.length) addManualRow();
        if (isManual && manualList && baseAmountInput?.value) {
            const firstAmount = manualList.querySelector('.manual-period-amount');
            if (firstAmount && !firstAmount.value) firstAmount.value = baseAmountInput.value;
        }
        serializeManualPeriods();
    };

    repeatType?.addEventListener('change', updateRepeatUI);
    updateRepeatUI();
}
function openAddDebtModal() {
    const modal = openModal('Добавить долг', buildDebtForm(), formData => {
        const repeatType = formData.repeatType || 'none';
        let manualPeriods = [];
        if (repeatType === 'manual') {
            try { manualPeriods = JSON.parse(formData.manualPeriodsJson || '[]'); } catch { manualPeriods = []; }
            manualPeriods = manualPeriods.filter(p => p && p.dueDate && Number(p.amount) > 0);
            if (!manualPeriods.length) throw new Error('Добавьте хотя бы один период с датой и суммой');
            const uniqueDates = new Set(manualPeriods.map(p => p.dueDate));
            if (uniqueDates.size !== manualPeriods.length) throw new Error('Даты периодов не должны повторяться');
        }
        const baseAmount = repeatType === 'manual'
            ? Number(manualPeriods[0]?.amount || 0)
            : Number(formData.baseAmount || 0);
        if (baseAmount <= 0) throw new Error('Некорректная сумма');
        const debt = {
            id: makeId('debt'),
            title: formData.title.trim(),
            baseAmount,
            amount: baseAmount,
            paidAmount: 0,
            categoryId: formData.categoryId || '',
            subcategoryId: formData.subcategoryId || null,
            dueDate: formData.dueDate || '',
            comment: formData.comment || '',
            createdAt: new Date().toISOString(),
            repeatEnabled: repeatType !== 'none',
            repeatType,
            repeatInterval: Math.max(1, Number(formData.repeatInterval || 1)),
            lastRepeatDateEnd: formData.repeatEndDate || '',
            periods: [], archivedPeriods: [], transactionIds: [], showOnDashboard: true,
            isOverdue: false, isArchived: false
        };
        if (repeatType === 'manual') {
            debt.periods = manualPeriods.map(p => createPeriod(debt, p.dueDate, {
                amount: Number(p.amount),
                comment: p.comment || 'Ожидает оплаты'
            }));
            debt.dueDate = [...manualPeriods].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].dueDate;
            recalcDebtFromPeriods(debt);
            updateManualScheduleSnapshot(debt);
        } else if (debt.repeatEnabled) {
            rebuildPeriodsForEditedDebt(debt, []);
        }
        const debts = getDebts();
        debts.push(debt);
        saveDebts(debts);
        renderDebts(); populateCategoryFilter();
        document.dispatchEvent(new Event('debt-updated'));
        showToast('Долг добавлен', 'success');
    });
    attachDebtFormListeners(modal);
}

function openEditDebtModal(id) {
    const debt = getDebts().find(d => d.id === id);
    if (!debt) return;
    const modal = openModal('Редактировать долг', buildDebtForm(debt), formData => {
        const debts = getDebts();
        const index = debts.findIndex(d => d.id === id);
        if (index < 0) return;
        const current = debts[index];
        const oldPeriods = (current.periods || []).map(p => ({ ...p }));
        const oldPaid = Number(current.paidAmount || 0);
        const repeatType = formData.repeatType || 'none';
        const baseAmount = Number(formData.baseAmount || 0);
        if (baseAmount <= 0) throw new Error('Некорректная сумма');

        Object.assign(current, {
            title: formData.title.trim(),
            baseAmount,
            categoryId: formData.categoryId || '',
            subcategoryId: formData.subcategoryId || null,
            dueDate: formData.dueDate || '',
            comment: formData.comment || '',
            repeatEnabled: repeatType !== 'none',
            repeatType,
            repeatInterval: Math.max(1, Number(formData.repeatInterval || 1)),
            lastRepeatDateEnd: formData.repeatEndDate || '',
            showOnDashboard: formData.showOnDashboard === 'true'
        });

        if (repeatType === 'none') {
            current.periods = [];
            current.amount = baseAmount;
            current.paidAmount = Math.min(Number(formData.paidAmount ?? oldPaid), baseAmount);
        } else {
            rebuildPeriodsForEditedDebt(current, oldPeriods);
            if (repeatType === 'manual') updateManualScheduleSnapshot(current);
            // If total paid was manually changed, redistribute while preserving period metadata.
            const requestedPaid = Number(formData.paidAmount ?? current.paidAmount);
            if (Number.isFinite(requestedPaid) && Math.abs(requestedPaid - current.paidAmount) > 0.005) {
                applyPaidAmountToPeriods(current, Math.max(0, requestedPaid));
            }
        }
        current.isArchived = false;
        current.archivedAt = '';
        debts[index] = current;
        saveDebts(debts);
        updateDebtStatuses(); renderDebts(); populateCategoryFilter();
        document.dispatchEvent(new Event('debt-updated'));
        showToast('Долг обновлён', 'success');
    });
    attachDebtFormListeners(modal);
}

function applyPaidAmountToPeriods(debt, totalPaid) {
    if (!debt.periods?.length) { debt.paidAmount = Math.min(totalPaid, debt.amount); return; }
    let remaining = Math.max(0, Number(totalPaid || 0));
    [...debt.periods].sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate))).forEach(period => {
        period.paidAmount = Math.min(Number(period.amount || 0), remaining);
        if (period.paidAmount > 0 && !period.paymentDate) period.paymentDate = toDateString(new Date());
        if (period.paidAmount === 0) period.paymentDate = '';
        remaining -= period.paidAmount;
    });
    recalcDebtFromPeriods(debt);
}

function getCategoryNames(debt) {
    const category = storageInstance.getCategory(debt.categoryId);
    const sub = debt.subcategoryId ? storageInstance.getCategory(debt.subcategoryId) : null;
    return { category, sub };
}

function addDebtTransaction(debt, amount, date, description, periodId = null) {
    const { category, sub } = getCategoryNames(debt);
    const tx = storageInstance.addTransaction({
        type: 'expense', amount: Number(amount), date,
        description: description || `Оплата долга: ${debt.title}`,
        categoryId: debt.categoryId || '', categoryName: category?.name || '',
        subcategoryId: debt.subcategoryId || '', subcategoryName: sub?.name || '',
        comment: debt.comment || '', isDebtPayment: true, debtId: debt.id, periodId
    });
    debt.transactionIds = Array.isArray(debt.transactionIds) ? debt.transactionIds : [];
    debt.transactionIds.push(tx.id);
    if (periodId) {
        const period = debt.periods?.find(p => p.id === periodId);
        if (period) {
            period.transactionIds = Array.isArray(period.transactionIds) ? period.transactionIds : [];
            period.transactionIds.push(tx.id);
        }
    }
    return tx;
}

function distributePayment(debt, amount, paymentDate) {
    let remaining = Number(amount || 0);
    if (!debt.periods?.length) {
        const available = Math.max(debt.amount - debt.paidAmount, 0);
        const paid = Math.min(available, remaining);
        debt.paidAmount += paid;
        return [{ amount: paid, periodId: null }].filter(x => x.amount > 0);
    }
    const result = [];
    const periods = [...debt.periods].sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    for (const period of periods) {
        if (remaining <= 0) break;
        const available = Math.max(Number(period.amount || 0) - Number(period.paidAmount || 0), 0);
        const paid = Math.min(available, remaining);
        if (!paid) continue;
        period.paidAmount = Number(period.paidAmount || 0) + paid;
        period.paymentDate = paymentDate;
        period.comment = period.paidAmount >= period.amount ? 'Оплачено' : period.comment;
        result.push({ amount: paid, periodId: period.id });
        remaining -= paid;
    }
    recalcDebtFromPeriods(debt);
    return result;
}

function openPayDebtModal(id, mode = 'full') {
    const debt = getDebts().find(d => d.id === id);
    if (!debt) return;
    const remaining = Math.max(Number(debt.amount || 0) - Number(debt.paidAmount || 0), 0);
    if (remaining <= 0) { showToast('Долг уже погашен', 'info'); return; }
    const today = toDateString(new Date());
    openModal(mode === 'full' ? 'Погасить долг' : 'Пополнить частично', `<form>
        <div style="display:grid;gap:12px;">
            <div>Осталось: <b>${remaining.toFixed(2)} ₽</b></div>
            <label>Сумма<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${mode === 'full' ? remaining : ''}" required style="${fieldStyle('margin-top:4px;')}"></label>
            <label>Дата оплаты<input name="date" type="date" value="${today}" required style="${fieldStyle('margin-top:4px;')}"></label>
            <button class="btn btn-primary" type="submit">Сохранить оплату</button>
        </div></form>`, data => {
        const amount = Math.min(Number(data.amount || 0), remaining);
        if (amount <= 0) throw new Error('Некорректная сумма');
        const debts = getDebts();
        const index = debts.findIndex(d => d.id === id);
        const current = debts[index];
        const parts = distributePayment(current, amount, data.date || today);
        parts.forEach(part => addDebtTransaction(current, part.amount, data.date || today, `Оплата долга: ${current.title}`, part.periodId));
        debts[index] = current;
        saveDebts(debts);
        syncAllAutomaticPeriods(); updateDebtStatuses(); renderDebts();
        document.dispatchEvent(new Event('transaction-added'));
        document.dispatchEvent(new Event('debt-updated'));
        showToast('Оплата добавлена', 'success');
    });
}

function payCurrentPeriod(debtId) {
    const debt = getDebts().find(d => d.id === debtId);
    if (!debt?.periods?.length) return openPayDebtModal(debtId, 'partial');
    const period = [...debt.periods].sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate))).find(p => Number(p.paidAmount || 0) < Number(p.amount || 0));
    if (!period) { showToast('Все периоды оплачены', 'success'); return; }
    const remaining = Number(period.amount || 0) - Number(period.paidAmount || 0);
    const today = toDateString(new Date());
    openModal('Оплатить период', `<form><div style="display:grid;gap:12px;">
        <div>Период: <b>${formatDate(period.dueDate)}</b></div>
        <label>Сумма<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Дата оплаты<input name="date" type="date" value="${today}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <button class="btn btn-primary" type="submit">Оплатить</button>
    </div></form>`, data => {
        const amount = Math.min(Number(data.amount || 0), remaining);
        if (amount <= 0) throw new Error('Некорректная сумма');
        const debts = getDebts(); const i = debts.findIndex(d => d.id === debtId); const current = debts[i];
        const p = current.periods.find(x => x.id === period.id);
        p.paidAmount = Number(p.paidAmount || 0) + amount; p.paymentDate = data.date || today;
        if (p.paidAmount >= p.amount) p.comment = 'Оплачено';
        addDebtTransaction(current, amount, data.date || today, `Оплата периода ${formatDate(p.dueDate)}: ${current.title}`, p.id);
        recalcDebtFromPeriods(current); debts[i] = current; saveDebts(debts);
        syncAllAutomaticPeriods(); updateDebtStatuses(); renderDebts();
        document.dispatchEvent(new Event('transaction-added')); document.dispatchEvent(new Event('debt-updated'));
        showToast('Период оплачен', 'success');
    });
}

function restoreDebt(id) {
    const debts = getDebts(); const debt = debts.find(d => d.id === id); if (!debt) return;
    debt.isArchived = false; debt.archivedAt = ''; saveDebts(debts); renderDebts(); populateCategoryFilter();
    document.dispatchEvent(new Event('debt-updated')); showToast('Долг восстановлен', 'success');
}

function resetDebt(id) {
    const debts = getDebts(); const debt = debts.find(d => d.id === id); if (!debt) return;
    if (!confirm(`Сбросить оплаты по долгу «${debt.title}»? Связанные транзакции будут удалены.`)) return;
    const data = storageInstance.getData();
    const ids = new Set(debt.transactionIds || []);
    data.transactions = (data.transactions || []).filter(t => !ids.has(t.id) && t.debtId !== id);
    debt.transactionIds = []; debt.paidAmount = 0; debt.isArchived = false; debt.archivedAt = '';
    (debt.periods || []).forEach(p => { p.paidAmount = 0; p.paymentDate = ''; p.transactionIds = []; if (p.comment === 'Оплачено') p.comment = 'Ожидает оплаты'; });
    data.debts = debts; storageInstance.saveData(data); updateDebtStatuses(); renderDebts();
    document.dispatchEvent(new Event('transaction-deleted')); document.dispatchEvent(new Event('debt-updated'));
    showToast('Оплаты сброшены', 'success');
}

function deleteDebt(id) {
    const debts = getDebts(); const debt = debts.find(d => d.id === id); if (!debt) return;
    if (!confirm(`Удалить долг «${debt.title}»?`)) return;
    const data = storageInstance.getData();
    data.debts = debts.filter(d => d.id !== id);
    // Keep financial history, but detach transactions from deleted debt.
    data.transactions = (data.transactions || []).map(t => t.debtId === id ? { ...t, debtId: null, periodId: null } : t);
    storageInstance.saveData(data); renderDebts(); populateCategoryFilter(); document.dispatchEvent(new Event('debt-updated'));
    showToast('Долг удалён', 'success');
}

function openAddPeriodModal(parentId) {
    const debt = getDebts().find(d => d.id === parentId); if (!debt) return;
    const today = toDateString(new Date());
    openModal('Добавить период', `<form><div style="display:grid;gap:12px;">
        <label>Дата периода *<input name="date" type="date" value="${today}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Сумма *<input name="amount" type="number" min="0.01" step="0.01" value="${Number(debt.baseAmount || 0)}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Комментарий<textarea name="comment" style="${fieldStyle('margin-top:4px;min-height:60px;')}">Ожидает оплаты</textarea></label>
        <button class="btn btn-primary" type="submit">Добавить период</button>
    </div></form>`, data => {
        const amount = Number(data.amount || 0); if (amount <= 0) throw new Error('Некорректная сумма');
        const debts = getDebts(); const i = debts.findIndex(d => d.id === parentId); const current = debts[i];
        current.periods = Array.isArray(current.periods) ? current.periods : [];
        current.periods.push(createPeriod(current, data.date, { amount, comment: data.comment || 'Ожидает оплаты' }));
        if (current.repeatType === 'none') { current.repeatType = 'manual'; current.repeatEnabled = true; }
        recalcDebtFromPeriods(current); updateManualScheduleSnapshot(current); debts[i] = current; saveDebts(debts); updateDebtStatuses(); renderDebts();
        document.dispatchEvent(new Event('debt-updated')); showToast('Период добавлен', 'success');
    });
}

function openEditPeriodModal(id, parentId) {
    const debt = getDebts().find(d => d.id === parentId); const period = debt?.periods?.find(p => p.id === id);
    if (!debt || !period) { showToast('Период не найден', 'error'); return; }
    openModal('Редактировать период', `<form><div style="display:grid;gap:12px;">
        <label>Дата периода *<input name="date" type="date" value="${period.dueDate || ''}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Сумма *<input name="amount" type="number" min="0.01" step="0.01" value="${Number(period.amount || 0)}" required style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Оплачено<input name="paidAmount" type="number" min="0" step="0.01" value="${Number(period.paidAmount || 0)}" style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Дата оплаты<input name="paymentDate" type="date" value="${period.paymentDate || ''}" style="${fieldStyle('margin-top:4px;')}"></label>
        <label>Комментарий<textarea name="comment" style="${fieldStyle('margin-top:4px;min-height:60px;')}">${period.comment || ''}</textarea></label>
        <button class="btn btn-primary" type="submit">Сохранить период</button>
    </div></form>`, data => {
        const amount = Number(data.amount || 0), paid = Number(data.paidAmount || 0);
        if (amount <= 0 || paid < 0 || paid > amount) throw new Error('Некорректные суммы');
        const debts = getDebts(); const i = debts.findIndex(d => d.id === parentId); const current = debts[i]; const p = current.periods.find(x => x.id === id);
        Object.assign(p, { dueDate: data.date, amount, paidAmount: paid, paymentDate: data.paymentDate || '', comment: data.comment || '' });
        recalcDebtFromPeriods(current); updateManualScheduleSnapshot(current); debts[i] = current; saveDebts(debts); updateDebtStatuses(); renderDebts();
        document.dispatchEvent(new Event('debt-updated')); showToast('Период обновлён', 'success');
    });
}

function deletePeriod(id, parentId) {
    const debts = getDebts(); const i = debts.findIndex(d => d.id === parentId); if (i < 0) return;
    const debt = debts[i]; const period = debt.periods?.find(p => p.id === id); if (!period) return;
    if (!confirm(`Удалить период ${formatDate(period.dueDate)}?`)) return;
    const data = storageInstance.getData();
    const ids = new Set(period.transactionIds || []);
    data.transactions = (data.transactions || []).map(t => ids.has(t.id) ? { ...t, periodId: null } : t);
    debt.periods = debt.periods.filter(p => p.id !== id); debt.transactionIds = (debt.transactionIds || []).filter(x => !ids.has(x));
    recalcDebtFromPeriods(debt); updateManualScheduleSnapshot(debt); debts[i] = debt; data.debts = debts; storageInstance.saveData(data); updateDebtStatuses(); renderDebts();
    document.dispatchEvent(new Event('debt-updated')); showToast('Период удалён', 'success');
}

