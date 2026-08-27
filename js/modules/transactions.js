// ===== modules/transactions.js =====
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { formatDateToRussian } from '../utils/dateHelpers.js';

let storageInstance = null;
let currentFilter = 'all';

export function init(storage) {
    storageInstance = storage;
    currentFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === 'all');
    });
    renderTransactions();
    setupEventListeners();
    setTimeout(() => renderTransactions(currentFilter), 500);
}

function renderTransactions(filter = currentFilter) {
    const transactions = storageInstance.getData().transactions || [];
    const filtered = transactions.filter(t => filter === 'all' || t.type === filter);
    
    filtered.sort((a, b) => {
        const dateDiff = new Date(b.date || 0) - new Date(a.date || 0);
        return dateDiff !== 0 ? dateDiff : extractTimestamp(b.id) - extractTimestamp(a.id);
    });
    
    const container = document.getElementById('transactions-list');
    if (!container) return;
    
    container.innerHTML = '';
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'list-scroll';
    
    if (!filtered.length) {
        scrollContainer.innerHTML = `
            <div class="empty-state">
                <span class="icon">◻</span>
                <p>Нет транзакций</p>
                <button class="btn btn-primary" id="add-first-btn" style="margin-top:12px;">+ Добавить</button>
            </div>
        `;
        container.appendChild(scrollContainer);
        document.getElementById('add-first-btn')?.addEventListener('click', openAddModal);
        return;
    }
    
    scrollContainer.innerHTML = filtered.map(t => {
        const catId = t.categoryId || t.category || t.subcategoryId;
        const category = catId ? storageInstance.getCategory(catId) : null;
        
        let parentName = t.categoryName || '';
        let subName = t.subcategoryName || '';
        
        if (category) {
            if (category.parentId) {
                const parentCategory = storageInstance.getCategory(category.parentId);
                parentName = parentCategory?.name || t.categoryName || '';
                subName = category.name;
            } else {
                parentName = category.name;
                subName = '';
            }
        }
        
        let displayName = parentName || 'Без категории';
        if (subName) {
            displayName = `${parentName} (${subName})`;
        }
        
        const categoryColor = category?.color || '#666666';
        const formattedDate = formatDateToRussian(t.date);
        const amountColor = t.type === 'income' ? '#22C55E' : '#EF4444';
        const sign = t.type === 'income' ? '+' : '-';
        const isDebtPayment = t.isDebtPayment === true;
        
        return `
            <div class="transaction-item" data-id="${t.id}" 
                 data-parent-name="${(parentName || '').toLowerCase()}" 
                 data-sub-name="${(subName || '').toLowerCase()}" 
                 data-category-name="${(displayName || '').toLowerCase()}">
                <div class="left">
                    <div class="category-icon" style="background: ${categoryColor}20; color: ${categoryColor};"></div>
                    <div class="details">
                        <div class="title" style="color: ${categoryColor};">${displayName}${isDebtPayment ? ' 🔄' : ''}</div>
                        <div class="meta">${formattedDate} • ${t.description || 'Без описания'}${t.photo ? ' 📷' : ''}${t.comment ? ' 💬' : ''}</div>
                    </div>
                </div>
                <div class="amount" style="color: ${amountColor};">${sign} ${Number(t.amount || 0).toFixed(2)} ₽</div>
                <div class="actions">
                    ${t.photo ? `<button class="btn-photo" data-id="${t.id}" title="Показать фото">🖼</button>` : ''}
                    ${t.comment ? `<button class="btn-comment" data-id="${t.id}" title="Показать комментарий">💬</button>` : ''}
                    <button class="btn-edit" data-id="${t.id}">✎</button>
                    <button class="btn-delete" data-id="${t.id}">✕</button>
                </div>
            </div>
        `;
    }).join('');
    
    container.appendChild(scrollContainer);
    
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => deleteTransaction(e.currentTarget.dataset.id));
    });
    
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => openEditModal(e.currentTarget.dataset.id));
    });
    
    document.querySelectorAll('.btn-photo').forEach(btn => {
        btn.addEventListener('click', (e) => showPhotoModal(e.currentTarget.dataset.id));
    });
    
    document.querySelectorAll('.btn-comment').forEach(btn => {
        btn.addEventListener('click', (e) => showCommentModal(e.currentTarget.dataset.id));
    });
}

function extractTimestamp(id) {
    if (!id) return 0;
    const match = String(id).match(/^(\d+)_/);
    return match ? parseInt(match[1], 10) : (/^\d+$/.test(String(id)) ? parseInt(id, 10) : 0);
}

function setupEventListeners() {
    document.getElementById('add-transaction-btn')?.addEventListener('click', openAddModal);
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentFilter = e.currentTarget.dataset.filter;
            renderTransactions(currentFilter);
        });
    });
    
    document.getElementById('search-transactions')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const items = document.querySelectorAll('.transaction-item');
        
        items.forEach(item => {
            const parentName = item.dataset.parentName || '';
            const subName = item.dataset.subName || '';
            const categoryName = item.dataset.categoryName || '';
            const description = item.querySelector('.meta')?.textContent?.toLowerCase() || '';
            
            const matchesQuery = 
                parentName.includes(query) || 
                subName.includes(query) || 
                categoryName.includes(query) ||
                description.includes(query);
            
            item.style.display = matchesQuery ? 'flex' : 'none';
        });
    });
    
    document.addEventListener('transaction-added', () => renderTransactions(currentFilter));
    document.addEventListener('transaction-deleted', () => renderTransactions(currentFilter));
    document.addEventListener('debt-updated', () => renderTransactions(currentFilter));
    
    window.addEventListener('storage', (e) => {
        if (e.key === storageInstance.dbName) renderTransactions(currentFilter);
    });
}

function syncLinkedDebt(transaction) {
    if (!transaction?.isDebtPayment) return;
    
    const data = storageInstance.getData();
    const debts = data.debts || [];
    const debtIndex = debts.findIndex(debt =>
        transaction.debtId === debt.id ||
        (Array.isArray(debt.transactionIds) && debt.transactionIds.includes(transaction.id))
    );
    
    if (debtIndex === -1) return;
    
    const debt = debts[debtIndex];
    const linkedTransactions = (data.transactions || []).filter(t =>
        t.isDebtPayment && t.type === 'expense' &&
        (t.debtId === debt.id || (Array.isArray(debt.transactionIds) && debt.transactionIds.includes(t.id)))
    );
    
    debt.transactionIds = linkedTransactions.map(t => t.id);
    debt.paidAmount = Math.max(0, Math.min(
        linkedTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0),
        Number(debt.amount || 0)
    ));
    
    debts[debtIndex] = debt;
    data.debts = debts;
    storageInstance.saveData(data);
    
    document.dispatchEvent(new Event('debt-updated'));
    window.app?.refreshHeader?.();
}

function getDebtByTransaction(transaction) {
    const debts = storageInstance.getData().debts || [];
    return debts.find(debt =>
        transaction.debtId === debt.id ||
        (Array.isArray(debt.transactionIds) && debt.transactionIds.includes(transaction.id))
    ) || null;
}

function updateDebtAfterTransactionDelete(debt, deletedTransaction) {
    const data = storageInstance.getData();
    const debts = data.debts || [];
    const debtIndex = debts.findIndex(d => d.id === debt.id);
    if (debtIndex === -1) return;
    
    debt.transactionIds = (debt.transactionIds || []).filter(id => id !== deletedTransaction.id);
    
    const totalPaid = (data.transactions || [])
        .filter(t => t.isDebtPayment && t.type === 'expense' && t.id !== deletedTransaction.id &&
            (t.debtId === debt.id || (Array.isArray(debt.transactionIds) && debt.transactionIds.includes(t.id))))
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    
    debt.paidAmount = Math.max(0, Math.min(totalPaid, Number(debt.amount || 0)));
    debts[debtIndex] = debt;
    data.debts = debts;
    storageInstance.saveData(data);
}

function deleteTransaction(id) {
    const transaction = storageInstance.getTransaction(id);
    if (!transaction) return;
    
    const displayName = transaction.categoryName || transaction.subcategoryName || 'Без категории';
    
    openModal('Подтверждение удаления', `
        <div style="text-align:center;padding:12px 0;">
            <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
            <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:8px;">
                Вы уверены, что хотите удалить эту транзакцию?
            </p>
            <div style="
                background: var(--color-bg-secondary);
                border-radius: var(--radius-sm);
                padding: 12px 16px;
                margin: 12px 0;
                border-left: 3px solid #EF4444;
                text-align: left;
            ">
                <div style="font-weight:600;color:#EF4444;font-size:var(--font-size-sm);">
                    ${displayName}
                </div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                    ${formatDateToRussian(transaction.date)} • ${transaction.description || 'Без описания'}
                </div>
                <div style="font-size:var(--font-size-lg);font-weight:700;color:var(--color-text);margin-top:4px;">
                    ${transaction.type === 'income' ? '+' : '-'} ${transaction.amount.toFixed(2)} ₽
                </div>
            </div>
            <div style="display:flex;gap:12px;margin-top:16px;justify-content:center;">
                <button class="btn btn-outline" id="cancel-delete" style="flex:1;">Отмена</button>
                <button class="btn btn-danger" id="confirm-delete" style="flex:1;background:var(--color-text);color:var(--color-bg);border-color:var(--color-text);">Удалить</button>
            </div>
        </div>
    `, null);
    
    setTimeout(() => {
        document.getElementById('cancel-delete')?.addEventListener('click', () => {
            document.querySelector('.modal-overlay')?.remove();
        });
        
        document.getElementById('confirm-delete')?.addEventListener('click', () => {
            const debtData = getDebtByTransaction(transaction);
            storageInstance.deleteTransaction(id);
            
            if (debtData && transaction.isDebtPayment) {
                updateDebtAfterTransactionDelete(debtData, transaction);
            }
            
            renderTransactions(currentFilter);
            showToast('Транзакция удалена', 'success');
            window.app?.refreshHeader?.();
            document.dispatchEvent(new Event('transaction-deleted'));
            document.dispatchEvent(new Event('debt-updated'));
            document.querySelector('.modal-overlay')?.remove();
        });
    }, 100);
}

function showPhotoModal(id) {
    const transaction = storageInstance.getTransaction(id);
    if (!transaction?.photo) {
        showToast('Фото не найдено', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease;
        cursor: pointer;
    `;
    
    modal.innerHTML = `
        <div style="max-width: 90%; max-height: 90%; position: relative;">
            <button class="modal-close" style="
                position: absolute;
                top: -40px;
                right: 0;
                font-size: 28px;
                background: none;
                border: none;
                cursor: pointer;
                color: #fff;
                padding: 4px 8px;
                z-index: 10;
                transition: transform 0.2s;
            ">✕</button>
            <img src="${transaction.photo}" alt="Фото транзакции" style="
                max-width: 100%;
                max-height: 80vh;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                object-fit: contain;
            ">
            <div style="color: #fff; text-align: center; margin-top: 12px; font-size: 14px; opacity: 0.8;">
                ${transaction.description || 'Без описания'} • ${transaction.amount.toFixed(2)} ₽
                ${transaction.comment ? `<br><span style="font-size:12px;opacity:0.6;">${transaction.comment}</span>` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function showCommentModal(id) {
    const transaction = storageInstance.getTransaction(id);
    if (!transaction?.comment) {
        showToast('Комментарий не найден', 'error');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease;
    `;
    
    modal.innerHTML = `
        <div style="
            background: var(--color-bg-card);
            border-radius: var(--radius);
            padding: 24px;
            max-width: 420px;
            width: 90%;
            border: 1px solid var(--color-border);
            box-shadow: var(--shadow-lg);
        ">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-size:16px;font-weight:600;color:var(--color-text);">Комментарий</h3>
                <button class="modal-close" style="
                    font-size:18px;
                    background:none;
                    border:none;
                    cursor:pointer;
                    color:var(--color-text-secondary);
                    padding:4px 8px;
                    border-radius:var(--radius-sm);
                    transition:0.2s;
                ">✕</button>
            </div>
            <div style="
                background: var(--color-bg-secondary);
                border-radius: var(--radius-sm);
                padding: 16px;
                border: 1px solid var(--color-border);
                color: var(--color-text);
                font-size: var(--font-size-sm);
                line-height: 1.6;
                word-wrap: break-word;
                white-space: pre-wrap;
            ">
                ${transaction.comment}
            </div>
            <div style="margin-top:12px;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                ${transaction.description || 'Без описания'} • ${transaction.amount.toFixed(2)} ₽
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function getCategoryOptionsHTML(type, selectedMainCat = '') {
    const categories = storageInstance.getCategories().filter(c => c.type === type);
    const mainCats = categories.filter(c => !c.parentId);
    
    const mainOptions = mainCats.map(c => {
        const selected = c.id === selectedMainCat ? 'selected' : '';
        return `<option value="${c.id}" ${selected} style="color: ${c.color || '#666666'};">${c.name}</option>`;
    }).join('');
    
    return { mainOptions };
}

// ===== ФУНКЦИЯ: Генерация полей для распределения суммы по подкатегориям =====
function generateSplitFields(type, selectedMainCat = '') {
    if (!selectedMainCat) return '';
    
    const categories = storageInstance.getCategories();
    const subCats = categories.filter(c => c.type === type && c.parentId === selectedMainCat);
    
    if (!subCats.length) return '';
    
    return `
        <div id="split-container" style="margin-bottom:12px; border:1px solid var(--color-border); border-radius:6px; padding:12px; background:var(--color-bg-secondary);">
            <label style="display:block;font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:8px;font-weight:600;">
                📊 Распределить по подкатегориям
            </label>
            <div id="split-fields">
                ${subCats.map(sub => `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:var(--font-size-xs);color:${sub.color || '#666666'};flex:1;min-width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub.name}</span>
                        <input type="number" step="0.01" min="0" placeholder="0" data-subcat-id="${sub.id}" data-subcat-name="${sub.name}" style="flex:1;padding:6px 8px;border-radius:4px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:var(--font-size-sm);min-width:60px;">
                    </div>
                `).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);">
                <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">Распределено: <span id="split-total">0.00</span> ₽</span>
                <button type="button" id="split-apply" style="padding:4px 12px;background:var(--color-text);color:var(--color-bg);border:1px solid var(--color-text);border-radius:4px;font-size:var(--font-size-xs);cursor:pointer;font-family:var(--font-family);">Применить</button>
            </div>
        </div>
    `;
}

// ===== ФУНКЦИЯ: Обработка распределения =====
function bindSplitEvents() {
    const splitContainer = document.getElementById('split-container');
    if (!splitContainer) return;
    
    const amountInput = document.querySelector('input[name="amount"]');
    const splitTotalEl = document.getElementById('split-total');
    const splitApplyBtn = document.getElementById('split-apply');
    const splitInputs = splitContainer.querySelectorAll('input[data-subcat-id]');
    
    function updateSplitTotal() {
        let total = 0;
        splitInputs.forEach(input => {
            total += parseFloat(input.value) || 0;
        });
        if (splitTotalEl) {
            splitTotalEl.textContent = total.toFixed(2);
        }
    }
    
    function validateSplitAmount() {
        const mainAmount = parseFloat(amountInput?.value) || 0;
        const splitTotal = splitInputs.reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
        
        if (splitTotal > mainAmount && mainAmount > 0) {
            showToast('Сумма подкатегорий не может превышать основную сумму!', 'error');
            return false;
        }
        
        return true;
    }
    
    splitInputs.forEach(input => {
        input.addEventListener('input', () => {
            updateSplitTotal();
            validateSplitAmount();
        });
    });
    
    amountInput?.addEventListener('input', () => {
        validateSplitAmount();
    });
    
    splitApplyBtn?.addEventListener('click', () => {
        const total = splitInputs.reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
        const mainAmount = parseFloat(amountInput?.value) || 0;
        
        const hasAnyAmount = splitInputs.some(input => parseFloat(input.value) > 0);
        
        if (!hasAnyAmount) {
            showToast('Введите сумму хотя бы в одну подкатегорию', 'info');
            return;
        }
        
        if (total > mainAmount && mainAmount > 0) {
            showToast('Сумма подкатегорий не может превышать основную сумму!', 'error');
            return;
        }
        
        if (amountInput && total > 0) {
            amountInput.value = total.toFixed(2);
            showToast(`Сумма распределена: ${total.toFixed(2)} ₽`, 'success');
        } else {
            showToast('Сумма распределения равна 0', 'info');
        }
    });
}

// ===== ФУНКЦИЯ: Получение данных распределения =====
function getSplitData() {
    const splitContainer = document.getElementById('split-container');
    if (!splitContainer) return null;
    
    const splitInputs = splitContainer.querySelectorAll('input[data-subcat-id]');
    const selected = [];
    let total = 0;
    
    splitInputs.forEach(input => {
        const amount = parseFloat(input.value) || 0;
        if (amount > 0) {
            selected.push({
                id: input.dataset.subcatId,
                name: input.dataset.subcatName,
                amount: amount
            });
            total += amount;
        }
    });
    
    if (!selected.length) return null;
    
    const amountInput = document.querySelector('input[name="amount"]');
    const mainAmount = parseFloat(amountInput?.value) || 0;
    if (total > mainAmount) {
        showToast('Сумма подкатегорий не может превышать основную сумму!', 'error');
        return null;
    }
    
    return { items: selected, total };
}

// ===== ОБНОВЛЕННАЯ ФУНКЦИЯ: setupTransactionForm =====
function setupTransactionForm(transaction = null) {
    const type = transaction?.type || 'expense';
    const selectedMainCat = transaction ? 
        (storageInstance.getCategory(transaction.category)?.parentId ? storageInstance.getCategory(transaction.category).parentId : transaction.category) : '';
    
    const { mainOptions } = getCategoryOptionsHTML(type, selectedMainCat);
    const splitFields = generateSplitFields(type, selectedMainCat);
    
    return `
        <form id="transaction-form" enctype="multipart/form-data">
            <div style="display: flex; gap: 4px; background: var(--color-bg-secondary); padding: 4px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); margin-bottom: 12px;">
                <button type="button" class="type-btn ${type === 'expense' ? 'active' : ''}" data-type="expense" style="padding: 6px 14px; border: none; ${type === 'expense' ? 'background: var(--color-text); color: var(--color-bg);' : 'background: transparent; color: var(--color-text-secondary);'} border-radius: var(--radius-sm); font-family: var(--font-family); font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition); flex: 1;">Расход</button>
                <button type="button" class="type-btn ${type === 'income' ? 'active' : ''}" data-type="income" style="padding: 6px 14px; border: none; ${type === 'income' ? 'background: var(--color-text); color: var(--color-bg);' : 'background: transparent; color: var(--color-text-secondary);'} border-radius: var(--radius-sm); font-family: var(--font-family); font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; transition: var(--transition); flex: 1;">Доход</button>
            </div>
            
            <input name="amount" type="number" step="0.01" value="${transaction?.amount || ''}" placeholder="Сумма" required 
                   style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;font-size:var(--font-size-sm);box-sizing:border-box;">
            
            <select id="transaction-category" name="category" required style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;font-size:var(--font-size-sm);box-sizing:border-box;appearance:auto;">
                <option value="">Выберите категорию</option>
                ${mainOptions}
            </select>
            
            ${splitFields}
            
            <input name="date" type="date" value="${transaction?.date || new Date().toISOString().split('T')[0]}" required 
                   style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;font-size:var(--font-size-sm);box-sizing:border-box;">
            
            <textarea name="description" placeholder="Описание" 
                      style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;resize:vertical;min-height:60px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);">${transaction?.description || ''}</textarea>
            
            <textarea name="comment" placeholder="Комментарий (необязательно)" 
                      style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;resize:vertical;min-height:40px;font-size:var(--font-size-sm);box-sizing:border-box;font-family:var(--font-family);">${transaction?.comment || ''}</textarea>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:4px;font-weight:500;">Фото</label>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <label for="photo-input" style="
                        display:inline-flex;
                        align-items:center;
                        gap:6px;
                        padding:8px 16px;
                        background:var(--color-bg-secondary);
                        border:1px dashed var(--color-border);
                        border-radius:var(--radius-sm);
                        cursor:pointer;
                        transition:var(--transition);
                        font-size:var(--font-size-xs);
                        color:var(--color-text-secondary);
                    ">
                        <span style="font-size:16px;">📷</span>
                        ${transaction?.photo ? 'Заменить фото' : 'Выбрать фото'}
                    </label>
                    <input type="file" id="photo-input" accept="image/*" style="display:none;">
                    <span id="photo-filename" style="font-size:var(--font-size-xs);color:var(--color-text-muted);">${transaction?.photo ? 'Фото выбрано' : ''}</span>
                </div>
                <div id="photo-preview" style="${transaction?.photo ? 'display:inline-block;' : 'display:none;'}margin-top:8px;position:relative;">
                    <img id="preview-image" src="${transaction?.photo || ''}" alt="Превью" style="max-width:200px;max-height:150px;border-radius:4px;border:1px solid var(--color-border);object-fit:cover;">
                    <button type="button" id="remove-photo" style="
                        position:absolute;
                        top:-8px;
                        right:-8px;
                        background:var(--color-text);
                        color:var(--color-bg);
                        border:none;
                        border-radius:50%;
                        width:24px;
                        height:24px;
                        cursor:pointer;
                        font-size:14px;
                        line-height:24px;
                        text-align:center;
                        transition:transform 0.2s;
                        box-shadow:0 2px 4px rgba(0,0,0,0.2);
                    ">✕</button>
                </div>
            </div>
            
            <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;">${transaction ? 'Обновить' : 'Сохранить'}</button>
        </form>
    `;
}

function bindFormEvents() {
    const typeBtns = document.querySelectorAll('.type-btn');
    const categorySelect = document.getElementById('transaction-category');
    
    function updateSplitFields(type, selectedMainCat) {
        const oldSplit = document.getElementById('split-container');
        if (oldSplit) oldSplit.remove();
        
        const splitHtml = generateSplitFields(type, selectedMainCat);
        if (splitHtml) {
            categorySelect.insertAdjacentHTML('afterend', splitHtml);
            bindSplitEvents();
        }
    }
    
    typeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            typeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = 'var(--color-text-secondary)';
            });
            this.classList.add('active');
            this.style.background = 'var(--color-text)';
            this.style.color = 'var(--color-bg)';
            
            const type = this.dataset.type;
            const { mainOptions } = getCategoryOptionsHTML(type);
            categorySelect.innerHTML = `<option value="">Выберите категорию</option>${mainOptions}`;
            
            updateSplitFields(type, '');
        });
    });
    
    categorySelect.addEventListener('change', function() {
        const selectedId = this.value;
        const type = document.querySelector('.type-btn.active')?.dataset.type || 'expense';
        
        updateSplitFields(type, selectedId);
    });
}

function bindPhotoHandlers() {
    const photoInput = document.getElementById('photo-input');
    const photoPreview = document.getElementById('photo-preview');
    const previewImage = document.getElementById('preview-image');
    const removePhotoBtn = document.getElementById('remove-photo');
    const photoFilename = document.getElementById('photo-filename');
    let photoData = previewImage.src || null;
    
    photoInput?.addEventListener('change', function(e) {
        const file = this.files[0];
        if (file) {
            photoFilename.textContent = file.name;
            const reader = new FileReader();
            reader.onload = function(event) {
                photoData = event.target.result;
                previewImage.src = photoData;
                photoPreview.style.display = 'inline-block';
                const form = document.getElementById('transaction-form');
                let hiddenInput = document.getElementById('photo-hidden');
                if (!hiddenInput) {
                    hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = 'photo';
                    hiddenInput.id = 'photo-hidden';
                    form.appendChild(hiddenInput);
                }
                hiddenInput.value = photoData;
            };
            reader.readAsDataURL(file);
        }
    });
    
    removePhotoBtn?.addEventListener('click', function() {
        photoData = null;
        photoPreview.style.display = 'none';
        photoInput.value = '';
        photoFilename.textContent = '';
        const hidden = document.getElementById('photo-hidden');
        if (hidden) hidden.remove();
        const form = document.getElementById('transaction-form');
        let hiddenInput = document.getElementById('photo-hidden');
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = 'photo';
            hiddenInput.id = 'photo-hidden';
            form.appendChild(hiddenInput);
        }
        hiddenInput.value = '';
    });
}

function openAddModal() {
    openModal('Добавить транзакцию', setupTransactionForm(), (formData) => {
        const activeTypeBtn = document.querySelector('.type-btn.active');
        const selectedType = activeTypeBtn?.dataset.type || 'expense';
        
        let categoryId = formData.category;
        const category = storageInstance.getCategory(categoryId);
        
        const splitData = getSplitData();
        const hasSplit = splitData && splitData.items.length > 0;
        
        if (hasSplit) {
            storageInstance.addTransaction({
                type: selectedType,
                amount: parseFloat(formData.amount),
                category: categoryId,
                categoryName: category?.name || formData.category,
                date: formData.date,
                description: formData.description || '',
                comment: formData.comment || '',
                photo: formData.photo || '',
                isDebtPayment: false,
                splitData: {
                    items: splitData.items.map(item => ({
                        id: item.id,
                        name: item.name,
                        amount: item.amount
                    })),
                    total: splitData.total
                }
            });
            
            renderTransactions(currentFilter);
            showToast(`Транзакция создана с распределением по ${splitData.items.length} подкатегориям`, 'success');
            window.app?.refreshHeader?.();
            document.dispatchEvent(new Event('transaction-added'));
            return;
        }
        
        storageInstance.addTransaction({
            type: selectedType,
            amount: parseFloat(formData.amount),
            category: categoryId,
            categoryName: category?.name || formData.category,
            date: formData.date,
            description: formData.description || '',
            comment: formData.comment || '',
            photo: formData.photo || '',
            isDebtPayment: false
        });
        
        renderTransactions(currentFilter);
        showToast('Транзакция добавлена', 'success');
        window.app?.refreshHeader?.();
        document.dispatchEvent(new Event('transaction-added'));
    });
    
    bindFormEvents();
    bindPhotoHandlers();
}

function openEditModal(id) {
    const transaction = storageInstance.getTransaction(id);
    if (!transaction) return;
    
    openModal('Редактировать транзакцию', setupTransactionForm(transaction), (formData) => {
        const activeTypeBtn = document.querySelector('.type-btn.active');
        const selectedType = activeTypeBtn?.dataset.type || 'expense';
        
        let categoryId = formData.category;
        const category = storageInstance.getCategory(categoryId);
        
        const updated = {
            type: selectedType,
            amount: parseFloat(formData.amount),
            category: categoryId,
            categoryName: category?.name || formData.category,
            date: formData.date,
            description: formData.description || '',
            comment: formData.comment || '',
            photo: formData.photo || transaction.photo || '',
            isDebtPayment: transaction.isDebtPayment || false
        };
        
        const splitData = getSplitData();
        if (splitData && splitData.items.length > 0) {
            updated.splitData = {
                items: splitData.items.map(item => ({
                    id: item.id,
                    name: item.name,
                    amount: item.amount
                })),
                total: splitData.total
            };
        } else {
            delete updated.splitData;
        }
        
        const savedTransaction = storageInstance.updateTransaction(id, updated);
        syncLinkedDebt(savedTransaction);
        renderTransactions(currentFilter);
        showToast('Транзакция обновлена', 'success');
        window.app?.refreshHeader?.();
        document.dispatchEvent(new Event('transaction-added'));
    });
    
    bindFormEvents();
    bindPhotoHandlers();
    
    setTimeout(() => {
        if (transaction.splitData && transaction.splitData.items) {
            const splitContainer = document.getElementById('split-container');
            if (!splitContainer) return;
            
            transaction.splitData.items.forEach(item => {
                const amountInput = splitContainer.querySelector(`input[data-subcat-id="${item.id}"]`);
                if (amountInput) {
                    amountInput.value = item.amount;
                }
            });
            
            const splitTotalEl = document.getElementById('split-total');
            if (splitTotalEl) {
                splitTotalEl.textContent = transaction.splitData.total.toFixed(2);
            }
        } else if (transaction.subcategoryId && transaction.category) {
            const splitContainer = document.getElementById('split-container');
            if (!splitContainer) return;
            
            const amountInput = splitContainer.querySelector(`input[data-subcat-id="${transaction.subcategoryId}"]`);
            if (amountInput) {
                amountInput.value = transaction.amount;
            }
            
            const splitTotalEl = document.getElementById('split-total');
            if (splitTotalEl) {
                splitTotalEl.textContent = Number(transaction.amount).toFixed(2);
            }
        }
    }, 100);
}