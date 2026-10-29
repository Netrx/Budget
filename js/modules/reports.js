// ===== modules/reports.js =====
import { formatDateToRussian } from '../utils/dateHelpers.js';
import { showToast } from '../components/toast.js';

let storageInstance = null;
let charts = {
    monthly: null,
    pie: null,
    pieSub: null,
    pieIncome: null
};
let pieFilters = {
    period: 'month',
    category: 'all',
    dateStart: null,
    dateEnd: null
};

export function init(storage) {
    storageInstance = storage;

    const now = new Date();
    const dateStart = document.getElementById('report-pie-date-start');
    const dateEnd = document.getElementById('report-pie-date-end');
    if (dateStart) dateStart.value = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    if (dateEnd) dateEnd.value = toLocalDateString(now);

    pieFilters = {
        period: 'month',
        category: 'all',
        dateStart: null,
        dateEnd: null
    };

    populateCategoryFilters();
    setupEventListeners();
    updatePeriodButtons();
    renderReports();
}

function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getTransactionDate(transaction) {
    return String(transaction?.date || '').slice(0, 10);
}

function getTransactionCategoryIds(transaction) {
    return [
        transaction?.category,
        transaction?.categoryId,
        transaction?.subcategoryId,
        transaction?.incomeCategoryId
    ].filter(Boolean);
}

function getPrimaryTransactionCategoryId(transaction) {
    if (transaction?.type === 'income') {
        return transaction.incomeCategoryId || transaction.category || transaction.categoryId || '';
    }
    return transaction.subcategoryId || transaction.category || transaction.categoryId || '';
}

function getPeriodBounds() {
    const now = new Date();
    switch (pieFilters.period) {
        case 'all':
            return { start: null, end: null };
        case 'year':
            return {
                start: `${now.getFullYear()}-01-01`,
                end: `${now.getFullYear()}-12-31`
            };
        case 'month':
            return {
                start: toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
                end: toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0))
            };
        case 'week': {
            const mondayOffset = (now.getDay() + 6) % 7;
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
            return { start: toLocalDateString(start), end: toLocalDateString(end) };
        }
        case 'custom':
            return { start: pieFilters.dateStart, end: pieFilters.dateEnd };
        default:
            return { start: null, end: null };
    }
}

function getFilteredPieTransactions() {
    let transactions = storageInstance.getTransactions();
    const { start, end } = getPeriodBounds();

    if (start && end) {
        transactions = transactions.filter(transaction => {
            const date = getTransactionDate(transaction);
            return date && date >= start && date <= end;
        });
    }

    if (pieFilters.category !== 'all') {
        const category = storageInstance.getCategory(pieFilters.category);
        const allowedIds = new Set([pieFilters.category]);
        if (category) {
            storageInstance.getSubCategories(category.id).forEach(sub => allowedIds.add(sub.id));
        }
        transactions = transactions.filter(transaction =>
            getTransactionCategoryIds(transaction).some(id => allowedIds.has(id))
        );
    }

    return transactions;
}

function getAllTransactions() {
    return storageInstance.getTransactions();
}

function populateCategoryFilters() {
    const container = document.getElementById('category-filter-buttons');
    if (!container) return;
    
    const categories = storageInstance.getCategories();
    const expenseCategories = categories.filter(c => c.type === 'expense');
    const mainCategories = expenseCategories.filter(c => !c.parentId);
    
    const allTransactions = storageInstance.getTransactions();
    
    const categoriesWithTransactions = new Set();
    allTransactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            getTransactionCategoryIds(t).forEach(id => categoriesWithTransactions.add(id));
        });
    
    let html = `
        <button class="category-filter-btn active" data-category="all" style="padding: 4px 10px; border: 1px solid var(--color-text); background: var(--color-text); color: var(--color-bg); border-radius: var(--radius-sm); font-family: var(--font-family); font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition); white-space: nowrap;">Все</button>
    `;
    
    mainCategories.forEach(cat => {
        const subCats = expenseCategories.filter(c => c.parentId === cat.id);
        const hasTransactions = categoriesWithTransactions.has(cat.id) || 
            subCats.some(sub => categoriesWithTransactions.has(sub.id));
        
        if (hasTransactions) {
            const color = cat.color || '#666666';
            html += `
                <button class="category-filter-btn main-cat" data-category="${cat.id}" data-color="${color}" style="padding: 4px 10px; border: 1px solid var(--color-border); background: transparent; color: ${color}; border-radius: var(--radius-sm); font-family: var(--font-family); font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition); white-space: nowrap;">${cat.name}</button>
            `;
        }
    });
    
    container.innerHTML = html;

    const available = [...container.querySelectorAll('.category-filter-btn')];
    if (!available.some(btn => btn.dataset.category === pieFilters.category)) {
        pieFilters.category = 'all';
    }
    available.forEach(btn => {
        const active = btn.dataset.category === pieFilters.category;
        btn.classList.toggle('active', active);
        btn.style.border = active ? '1px solid var(--color-text)' : '1px solid var(--color-border)';
        btn.style.background = active ? 'var(--color-text)' : 'transparent';
        btn.style.color = active ? 'var(--color-bg)' : (btn.dataset.color || 'var(--color-text-secondary)');
    });
    
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.category-filter-btn').forEach(b => {
                b.classList.remove('active');
                b.style.border = '1px solid var(--color-border)';
                b.style.background = 'transparent';
                b.style.color = b.dataset.color || 'var(--color-text-secondary)';
            });
            
            this.classList.add('active');
            this.style.border = '1px solid var(--color-text)';
            this.style.background = 'var(--color-text)';
            this.style.color = 'var(--color-bg)';
            
            pieFilters.category = this.dataset.category;
            renderReports();
        });
    });
}

function renderReports() {
    const transactions = getFilteredPieTransactions();
    const categories = storageInstance.getCategories();

    renderCategoryStats(transactions, categories);
    renderMonthlyChart(transactions);
    renderExpensePieChart(transactions, categories);
    renderSubcategoryPieChart(transactions, categories);
    renderIncomePieChart(transactions, categories);
}

function renderCategoryStats(transactions, categories) {
    const container = document.getElementById('category-stats');
    if (!container) return;
    
    const stats = {};
    let hasData = false;
    
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            hasData = true;
            const catId = getPrimaryTransactionCategoryId(t);
            if (!stats[catId]) {
                const category = categories.find(c => c.id === catId);
                stats[catId] = {
                    id: catId,
                    name: category ? category.name : t.categoryName || catId,
                    color: category ? category.color : '#666666',
                    parentId: category ? category.parentId : null,
                    total: 0
                };
            }
            stats[catId].total += t.amount;
        });
    
    const grouped = {};
    Object.values(stats).forEach(stat => {
        const key = stat.parentId || stat.id;
        if (!grouped[key]) {
            const parentCategory = categories.find(c => c.id === key);
            grouped[key] = {
                id: key,
                name: parentCategory ? parentCategory.name : stat.name,
                color: parentCategory ? parentCategory.color : stat.color,
                total: 0,
                children: []
            };
        }
        if (stat.parentId) {
            grouped[key].children.push(stat);
        } else {
            grouped[key].children.push(stat);
        }
        grouped[key].total += stat.total;
    });
    
    const statsArray = Object.values(grouped)
        .filter(s => s.total > 0)
        .sort((a, b) => b.total - a.total);
    
    if (!hasData || !statsArray.length) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="icon">◻</span>
                Нет данных о расходах
            </div>
        `;
        return;
    }
    
    const maxTotal = statsArray[0]?.total || 1;
    
    container.innerHTML = statsArray.map((group, index) => {
        const percentage = (group.total / maxTotal * 100);
        const color = group.color || '#666666';
        const realChildren = group.children.filter(c => c.id !== group.id);
        const hasRealChildren = realChildren.length > 0;
        
        let childrenHtml = '';
        if (hasRealChildren) {
            const childMaxTotal = Math.max(...realChildren.map(c => c.total));
            childrenHtml = `
                <div class="subcategory-stats" style="display: none; padding-left: 20px; margin-top: 8px; border-left: 2px solid ${color};">
                    ${realChildren
                        .sort((a, b) => b.total - a.total)
                        .map(child => {
                            const childPercentage = (child.total / childMaxTotal * 100);
                            const childColor = child.color || '#666666';
                            return `
                                <div class="category-stat sub-stat" style="padding: 4px 0; animation: fadeIn 0.2s ease; display: flex; align-items: center; gap: var(--spacing-sm);">
                                    <span class="name" style="color: ${childColor}; font-size: var(--font-size-xs); flex: 1; min-width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${child.name}</span>
                                    <div class="bar-track" style="flex: 1; height: 4px; background: var(--color-bg-secondary); border-radius: var(--radius-sm); overflow: hidden;">
                                        <div class="bar-fill" style="width: ${Math.min(childPercentage, 100)}%; background: ${childColor}; height: 100%; border-radius: var(--radius-sm);"></div>
                                    </div>
                                    <span class="value" style="color: ${childColor}; font-size: var(--font-size-xs); min-width: 80px; text-align: right; flex-shrink: 0;">${child.total.toFixed(2)} ₽</span>
                                </div>
                            `;
                        }).join('')}
                </div>
            `;
        }
        
        const hasToggle = hasRealChildren;
        
        return `
            <div class="category-stat-wrapper" style="margin-bottom: 4px;">
                <div class="category-stat main-stat ${hasToggle ? 'clickable' : ''}" style="animation: fadeIn 0.3s ease ${index * 0.05}s both; padding: 6px 8px; border-radius: var(--radius-sm); cursor: ${hasToggle ? 'pointer' : 'default'}; display: flex; align-items: center; gap: var(--spacing-sm);">
                    <span class="name" style="color: ${color}; ${hasToggle ? 'font-weight: 600;' : ''} flex: 1; min-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${group.name}</span>
                    <div class="bar-track" style="flex: 1; height: 6px; background: var(--color-bg-secondary); border-radius: var(--radius-sm); overflow: hidden;">
                        <div class="bar-fill" style="width: ${Math.min(percentage, 100)}%; background: ${color}; height: 100%; border-radius: var(--radius-sm); transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                    </div>
                    <span class="value" style="color: ${color}; font-weight: ${hasToggle ? '600' : '500'}; min-width: 100px; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0;">${group.total.toFixed(2)} ₽</span>
                    ${hasToggle ? `<span class="toggle-icon" style="margin-left: 4px; color: ${color}; font-size: 12px; flex-shrink: 0; transition: transform 0.3s ease; display: inline-block; width: 16px; text-align: center;">▼</span>` : ''}
                </div>
                ${childrenHtml}
            </div>
        `;
    }).join('');
    
    setTimeout(() => {
        document.querySelectorAll('.main-stat.clickable').forEach(el => {
            el.removeEventListener('click', toggleSubcategories);
            el.addEventListener('click', toggleSubcategories);
        });
    }, 50);
}

function toggleSubcategories(e) {
    e.stopPropagation();
    const el = this;
    const wrapper = el.closest('.category-stat-wrapper');
    if (!wrapper) return;
    
    const childrenContainer = wrapper.querySelector('.subcategory-stats');
    const toggleIcon = el.querySelector('.toggle-icon');
    
    if (childrenContainer) {
        if (childrenContainer.style.display === 'none' || childrenContainer.style.display === '') {
            childrenContainer.style.display = 'block';
            if (toggleIcon) {
                toggleIcon.textContent = '▲';
            }
        } else {
            childrenContainer.style.display = 'none';
            if (toggleIcon) {
                toggleIcon.textContent = '▼';
            }
        }
    }
}

// ===== ФУНКЦИЯ: График динамики по месяцам (линейный, без заливки) =====
function renderMonthlyChart(transactions) {
    const canvas = document.getElementById('monthly-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const months = {};
    transactions.forEach(t => {
        if (!t.date) return;
        const month = t.date.substring(0, 7);
        if (!months[month]) months[month] = { income: 0, expense: 0 };
        if (t.type === 'income') months[month].income += t.amount;
        else months[month].expense += t.amount;
    });
    
    const labels = Object.keys(months).sort();
    const incomeData = labels.map(m => months[m].income);
    const expenseData = labels.map(m => months[m].expense);
    
    if (charts.monthly) {
        charts.monthly.destroy();
        charts.monthly = null;
    }
    
    if (!labels.length) {
        const parent = canvas.parentElement;
        const existing = parent.querySelector('.empty-state');
        if (!existing) {
            const msg = document.createElement('div');
            msg.className = 'empty-state';
            msg.innerHTML = '<span class="icon">◻</span>Нет данных для отображения';
            parent.appendChild(msg);
        }
        canvas.style.display = 'none';
        return;
    }
    
    canvas.style.display = 'block';
    const parent = canvas.parentElement;
    const existing = parent.querySelector('.empty-state');
    if (existing) existing.remove();
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#FFFFFF' : '#000000';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    
    charts.monthly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.map(l => {
                const [year, month] = l.split('-');
                const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                return `${months[parseInt(month) - 1]} ${year}`;
            }),
            datasets: [
                {
                    label: 'Доходы',
                    data: incomeData,
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#10B981',
                    pointBorderColor: isDark ? '#1A1A1A' : '#FFFFFF',
                    pointBorderWidth: 1
                },
                {
                    label: 'Расходы',
                    data: expenseData,
                    borderColor: '#EF4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#EF4444',
                    pointBorderColor: isDark ? '#1A1A1A' : '#FFFFFF',
                    pointBorderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        font: { size: 11, weight: '500' },
                        boxWidth: 12,
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: textColor,
                        font: { size: 10 },
                        callback: value => value + ' ₽',
                        maxTicksLimit: 6
                    },
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: textColor,
                        font: { size: 9 },
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 12
                    },
                    grid: {
                        display: false
                    }
                }
            },
            animation: {
                duration: 600,
                easing: 'easeOutQuart'
            }
        }
    });
}

// ===== ФУНКЦИЯ: График расходов по родительским категориям =====
function renderExpensePieChart(transactions, categories) {
    const canvas = document.getElementById('expense-pie-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const expenseByParentCategory = {};
    let hasData = false;
    
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            hasData = true;
            const catId = getPrimaryTransactionCategoryId(t);
            const category = categories.find(c => c.id === catId);
            const parentId = category?.parentId || catId;
            
            if (!expenseByParentCategory[parentId]) {
                const parentCategory = categories.find(c => c.id === parentId);
                expenseByParentCategory[parentId] = {
                    name: parentCategory?.name || category?.name || t.categoryName || parentId,
                    color: parentCategory?.color || category?.color || '#666666',
                    total: 0
                };
            }
            expenseByParentCategory[parentId].total += t.amount;
        });
    
    const items = Object.values(expenseByParentCategory).filter(item => item.total > 0);
    
    items.sort((a, b) => b.total - a.total);
    
    const labels = items.map(item => item.name);
    const data = items.map(item => item.total);
    const colors = items.map(item => item.color || '#666666');
    
    if (charts.pie) {
        charts.pie.destroy();
        charts.pie = null;
    }
    
    if (!hasData || !data.length) {
        const parent = canvas.parentElement;
        const existing = parent.querySelector('.empty-state');
        if (!existing) {
            const msg = document.createElement('div');
            msg.className = 'empty-state';
            msg.innerHTML = '<span class="icon">◻</span>Нет данных о расходах';
            parent.appendChild(msg);
        }
        canvas.style.display = 'none';
        return;
    }
    
    canvas.style.display = 'block';
    const parent = canvas.parentElement;
    const existing = parent.querySelector('.empty-state');
    if (existing) existing.remove();
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    charts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: isDark ? '#1A1A1A' : '#FFFFFF',
                borderWidth: 3,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            return `${label}: ${value.toFixed(2)} ₽ (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                duration: 600,
                easing: 'easeOutQuart'
            }
        }
    });
    
    const legendContainer = document.getElementById('expense-pie-legend');
    if (legendContainer) {
        legendContainer.innerHTML = items.map((item, index) => `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin: 2px 8px 2px 0;
                font-size: var(--font-size-xs);
                color: ${item.color};
                font-weight: 500;
            ">
                <span style="
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: ${item.color};
                    display: inline-block;
                    flex-shrink: 0;
                "></span>
                ${item.name}
            </span>
        `).join('');
    }
}

// ===== ФУНКЦИЯ: График расходов по подкатегориям =====
function renderSubcategoryPieChart(transactions, categories) {
    const canvas = document.getElementById('subcategory-pie-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const expenseBySubcategory = {};
    let hasData = false;
    
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            hasData = true;
            const catId = getPrimaryTransactionCategoryId(t);
            const category = categories.find(c => c.id === catId);
            
            if (t.splitData && t.splitData.items && t.splitData.items.length > 0) {
                t.splitData.items.forEach(item => {
                    const subCategory = categories.find(c => c.id === item.id);
                    const subParentId = subCategory?.parentId || catId;
                    
                    if (!expenseBySubcategory[item.id]) {
                        expenseBySubcategory[item.id] = {
                            name: item.name || subCategory?.name || 'Подкатегория',
                            color: subCategory?.color || '#666666',
                            parentId: subParentId,
                            parentName: categories.find(c => c.id === subParentId)?.name || '',
                            total: 0
                        };
                    }
                    expenseBySubcategory[item.id].total += item.amount;
                });
            } else {
                if (category?.parentId) {
                    const subParentId = category.parentId;
                    
                    if (!expenseBySubcategory[catId]) {
                        expenseBySubcategory[catId] = {
                            name: category.name,
                            color: category.color || '#666666',
                            parentId: subParentId,
                            parentName: categories.find(c => c.id === subParentId)?.name || '',
                            total: 0
                        };
                    }
                    expenseBySubcategory[catId].total += t.amount;
                }
            }
        });
    
    const items = Object.values(expenseBySubcategory).filter(item => item.total > 0);
    
    items.sort((a, b) => b.total - a.total);
    
    const labels = items.map(item => `${item.name}${item.parentName ? ` (${item.parentName})` : ''}`);
    const data = items.map(item => item.total);
    const colors = items.map(item => item.color || '#666666');
    
    if (charts.pieSub) {
        charts.pieSub.destroy();
        charts.pieSub = null;
    }
    
    if (!hasData || !data.length) {
        const parent = canvas.parentElement;
        const existing = parent.querySelector('.empty-state');
        if (!existing) {
            const msg = document.createElement('div');
            msg.className = 'empty-state';
            msg.innerHTML = '<span class="icon">◻</span>Нет данных о подкатегориях';
            parent.appendChild(msg);
        }
        canvas.style.display = 'none';
        return;
    }
    
    canvas.style.display = 'block';
    const parent = canvas.parentElement;
    const existing = parent.querySelector('.empty-state');
    if (existing) existing.remove();
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    charts.pieSub = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: isDark ? '#1A1A1A' : '#FFFFFF',
                borderWidth: 3,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            return `${label}: ${value.toFixed(2)} ₽ (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                duration: 600,
                easing: 'easeOutQuart'
            }
        }
    });
    
    const legendContainer = document.getElementById('subcategory-pie-legend');
    if (legendContainer) {
        legendContainer.innerHTML = items.map((item, index) => `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin: 2px 8px 2px 0;
                font-size: var(--font-size-xs);
                color: ${item.color};
                font-weight: 500;
            ">
                <span style="
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: ${item.color};
                    display: inline-block;
                    flex-shrink: 0;
                "></span>
                ${item.name}
                ${item.parentName ? `<span style="color: var(--color-text-secondary); font-size: 9px;">(${item.parentName})</span>` : ''}
            </span>
        `).join('');
    }
}

// ===== ФУНКЦИЯ: График доходов по родительским категориям =====
function renderIncomePieChart(transactions, categories) {
    const canvas = document.getElementById('income-pie-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const incomeTransactions = transactions.filter(t => t.type === 'income');
    
    const incomeByParentCategory = {};
    let hasData = false;
    
    incomeTransactions.forEach(t => {
        hasData = true;
        const catId = getPrimaryTransactionCategoryId(t);
        const category = categories.find(c => c.id === catId);
        const parentId = category?.parentId || catId;
        
        if (!incomeByParentCategory[parentId]) {
            const parentCategory = categories.find(c => c.id === parentId);
            incomeByParentCategory[parentId] = {
                name: parentCategory?.name || category?.name || t.categoryName || parentId,
                color: parentCategory?.color || category?.color || '#22C55E',
                total: 0
            };
        }
        incomeByParentCategory[parentId].total += t.amount;
    });
    
    const items = Object.values(incomeByParentCategory).filter(item => item.total > 0);
    
    items.sort((a, b) => b.total - a.total);
    
    const labels = items.map(item => item.name);
    const data = items.map(item => item.total);
    const colors = items.map(item => item.color || '#22C55E');
    
    if (charts.pieIncome) {
        charts.pieIncome.destroy();
        charts.pieIncome = null;
    }
    
    if (!hasData || !data.length) {
        const parent = canvas.parentElement;
        const existing = parent.querySelector('.empty-state');
        if (!existing) {
            const msg = document.createElement('div');
            msg.className = 'empty-state';
            msg.innerHTML = '<span class="icon">◻</span>Нет данных о доходах';
            parent.appendChild(msg);
        }
        canvas.style.display = 'none';
        return;
    }
    
    canvas.style.display = 'block';
    const parent = canvas.parentElement;
    const existing = parent.querySelector('.empty-state');
    if (existing) existing.remove();
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    charts.pieIncome = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: isDark ? '#1A1A1A' : '#FFFFFF',
                borderWidth: 3,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            return `${label}: ${value.toFixed(2)} ₽ (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                duration: 600,
                easing: 'easeOutQuart'
            }
        }
    });
    
    const legendContainer = document.getElementById('income-pie-legend');
    if (legendContainer) {
        legendContainer.innerHTML = items.map((item, index) => `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin: 2px 8px 2px 0;
                font-size: var(--font-size-xs);
                color: ${item.color};
                font-weight: 500;
            ">
                <span style="
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: ${item.color};
                    display: inline-block;
                    flex-shrink: 0;
                "></span>
                ${item.name}
            </span>
        `).join('');
    }
}

function updatePeriodButtons() {
    document.querySelectorAll('.period-btn-pie').forEach(btn => {
        const active = btn.dataset.period === pieFilters.period;
        btn.classList.toggle('active', active);
        btn.style.background = active ? 'var(--color-text)' : 'transparent';
        btn.style.color = active ? 'var(--color-bg)' : 'var(--color-text-secondary)';
    });
}

function setupEventListeners() {
    const customDates = document.getElementById('pie-custom-dates');
    const dateStart = document.getElementById('report-pie-date-start');
    const dateEnd = document.getElementById('report-pie-date-end');
    const applyDatesBtn = document.getElementById('apply-pie-dates');

    document.querySelectorAll('.period-btn-pie').forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            pieFilters.period = period;
            updatePeriodButtons();

            if (period === 'custom') {
                customDates.style.display = 'flex';
                const now = new Date();
                if (!dateStart.value) dateStart.value = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
                if (!dateEnd.value) dateEnd.value = toLocalDateString(now);
                pieFilters.dateStart = dateStart.value;
                pieFilters.dateEnd = dateEnd.value;
            } else {
                customDates.style.display = 'none';
                pieFilters.dateStart = null;
                pieFilters.dateEnd = null;
            }
            renderReports();
        });
    });

    applyDatesBtn?.addEventListener('click', () => {
        if (!dateStart.value || !dateEnd.value) {
            showToast('Выберите обе даты', 'error');
            return;
        }
        if (dateStart.value > dateEnd.value) {
            showToast('Начальная дата не может быть позже конечной', 'error');
            return;
        }
        pieFilters.period = 'custom';
        pieFilters.dateStart = dateStart.value;
        pieFilters.dateEnd = dateEnd.value;
        customDates.style.display = 'flex';
        updatePeriodButtons();
        renderReports();
        showToast(`Период: ${formatDateShort(dateStart.value)} — ${formatDateShort(dateEnd.value)}`, 'success');
    });

    document.addEventListener('transaction-added', () => {
        populateCategoryFilters();
        renderReports();
    });
    document.addEventListener('transaction-deleted', () => {
        populateCategoryFilters();
        renderReports();
    });
    document.addEventListener('transaction-updated', () => {
        populateCategoryFilters();
        renderReports();
    });
    document.addEventListener('theme-changed', renderReports);
}

function formatDateShort(dateString) {
    if (!dateString) return '';
    const parts = dateString.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}