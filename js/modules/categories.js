// ===== МОДУЛЬ: КАТЕГОРИИ =====
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { CATEGORY_ICONS, CATEGORY_COLORS, CATEGORY_TYPES } from '../config/constants.js';

let storageInstance = null;
let currentType = 'income';

export function init(storage) {
    storageInstance = storage;
    renderCategories();
    setupEventListeners();
}

function renderCategories() {
    const categories = storageInstance.getCategoriesByType(currentType);
    const tree = buildCategoryTree(categories);
    const container = document.getElementById('categories-grid');

    let html = `
        <div class="category-card add-category-card" id="add-category-card">
            <span class="plus">+</span>
            <span class="text">Добавить категорию</span>
        </div>
    `;

    tree.forEach(cat => {
        const count = getTransactionCount(cat.id);
        const subCount = cat.children.reduce((sum, sub) => sum + getTransactionCount(sub.id), 0);
        const totalCount = count + subCount;
        const color = cat.color || '#666666';

        html += `
            <div class="category-card" data-cat-id="${cat.id}">
                <div class="category-header">
                    <span class="category-icon" style="color: ${color};">${cat.icon || '◻'}</span>
                    <span class="category-name" style="color: ${color};">${cat.name}</span>
                    <button class="btn-add-sub" data-id="${cat.id}">+</button>
                    <button class="btn-edit-cat" data-id="${cat.id}">✎</button>
                    <button class="btn-delete-cat" data-id="${cat.id}">✕</button>
                </div>
                <div class="category-count">${totalCount} тр.</div>
                ${renderSubcategories(cat.children)}
            </div>
        `;
    });

    container.innerHTML = html;

    document.getElementById('add-category-card')?.addEventListener('click', () => openAddCategoryModal(null));

    document.querySelectorAll('.btn-add-sub').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const parentId = e.currentTarget.dataset.id;
            openAddCategoryModal(parentId);
        });
    });

    document.querySelectorAll('.btn-edit-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            openEditCategoryModal(id);
        });
    });

    document.querySelectorAll('.btn-delete-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            deleteCategory(id);
        });
    });

    document.querySelectorAll('.sub-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            openEditCategoryModal(id);
        });
    });

    document.querySelectorAll('.sub-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            deleteCategory(id);
        });
    });
}

function renderSubcategories(children) {
    if (!children || !children.length) return '';

    let html = '<div class="subcategories">';
    children.forEach(sub => {
        const count = getTransactionCount(sub.id);
        const color = sub.color || '#666666';
        html += `
            <div class="subcategory-item">
                <span class="sub-name" style="color: ${color};">${sub.name}</span>
                <span class="sub-count">${count}</span>
                <div class="sub-actions">
                    <button class="sub-edit" data-id="${sub.id}">✎</button>
                    <button class="sub-delete" data-id="${sub.id}">✕</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    return html;
}

function buildCategoryTree(categories) {
    const mainCategories = categories.filter(c => !c.parentId);
    return mainCategories.map(cat => ({
        ...cat,
        children: categories.filter(c => c.parentId === cat.id)
    }));
}

function getTransactionCount(categoryId) {
    const transactions = storageInstance.getTransactions();
    return transactions.filter(t => t.category === categoryId).length;
}

function setupEventListeners() {
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentType = e.currentTarget.dataset.type;
            renderCategories();
        });
    });

    document.getElementById('add-category-btn')?.addEventListener('click', () => openAddCategoryModal(null));

    document.addEventListener('transaction-added', () => renderCategories());
    document.addEventListener('transaction-deleted', () => renderCategories());
}

// ===== ИЗМЕНЕНИЕ №5: ИСПРАВЛЕНИЕ СОХРАНЕНИЯ ЦВЕТА =====
function openAddCategoryModal(parentId = null) {
    const iconOptions = CATEGORY_ICONS.map(icon => 
        `<option value="${icon.value}">${icon.value} ${icon.label}</option>`
    ).join('');

    const colorOptions = CATEGORY_COLORS.map(color => 
        `<option value="${color.value}" style="background-color: ${color.value}; color: ${isLightColor(color.value) ? '#000' : '#fff'}; padding: 4px 8px;">${color.label}</option>`
    ).join('');

    const typeOptions = Object.values(CATEGORY_TYPES).map(type => 
        `<option value="${type}">${type === 'income' ? 'Доход' : 'Расход'}</option>`
    ).join('');

    const parentCategories = storageInstance.getCategoriesByType(currentType).filter(c => !c.parentId);
    const parentOptions = parentCategories.map(c => 
        `<option value="${c.id}">${c.icon || '◻'} ${c.name}</option>`
    ).join('');

    const title = parentId ? 'Добавить подкатегорию' : 'Добавить категорию';

    openModal(title, `
        <form id="category-form">
            <div style="display:flex;gap:12px;margin-bottom:12px;">
                <select name="type" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${typeOptions}
                </select>
                <select name="icon" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${iconOptions}
                </select>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:12px;">
                <input name="name" type="text" placeholder="Название категории" required 
                       style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                <!-- ===== ИСПРАВЛЕНО: name="color" и значение берется правильно ===== -->
                <select name="color" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${colorOptions}
                </select>
            </div>
            ${parentId ? `<input type="hidden" name="parentId" value="${parentId}">` : `
                <select name="parentId" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);margin-bottom:12px;">
                    <option value="">Без родителя (главная)</option>
                    ${parentOptions}
                </select>
            `}
            <button type="submit" class="btn btn-primary" style="width:100%;">Сохранить</button>
        </form>
    `, (formData) => {
        // ===== ИСПРАВЛЕНО: явно берем color из formData =====
        const category = {
            name: formData.name,
            icon: formData.icon || '◻',
            color: formData.color || '#666666',  // Теперь цвет точно сохраняется
            type: formData.type || currentType,
            parentId: formData.parentId || parentId || null
        };
        storageInstance.addCategory(category);
        renderCategories();
        showToast('Категория добавлена', 'success');
    });
}

function openEditCategoryModal(id) {
    const category = storageInstance.getCategory(id);
    if (!category) return;

    const iconOptions = CATEGORY_ICONS.map(icon => 
        `<option value="${icon.value}" ${icon.value === category.icon ? 'selected' : ''}>${icon.value} ${icon.label}</option>`
    ).join('');

    const colorOptions = CATEGORY_COLORS.map(color => 
        `<option value="${color.value}" ${color.value === category.color ? 'selected' : ''} style="background-color: ${color.value}; color: ${isLightColor(color.value) ? '#000' : '#fff'}; padding: 4px 8px;">${color.label}</option>`
    ).join('');

    const typeOptions = Object.values(CATEGORY_TYPES).map(type => 
        `<option value="${type}" ${type === category.type ? 'selected' : ''}>${type === 'income' ? 'Доход' : 'Расход'}</option>`
    ).join('');

    openModal('Редактировать категорию', `
        <form id="category-form">
            <div style="display:flex;gap:12px;margin-bottom:12px;">
                <select name="type" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${typeOptions}
                </select>
                <select name="icon" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${iconOptions}
                </select>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:12px;">
                <input name="name" type="text" value="${category.name}" placeholder="Название категории" required 
                       style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                <select name="color" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg-input);color:var(--color-text);">
                    ${colorOptions}
                </select>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;">Обновить</button>
        </form>
    `, (formData) => {
        // ===== ИСПРАВЛЕНО: явно берем color из formData =====
        const updated = {
            name: formData.name,
            icon: formData.icon || '◻',
            color: formData.color || '#666666',  // Теперь цвет точно сохраняется
            type: formData.type
        };
        storageInstance.updateCategory(id, updated);
        renderCategories();
        showToast('Категория обновлена', 'success');
    });
}

function deleteCategory(id) {
    const category = storageInstance.getCategory(id);
    if (!category) return;

    const children = storageInstance.getSubCategories(id);
    const message = children.length > 0 
        ? `Удалить категорию "${category.name}" и все её подкатегории (${children.length})?` 
        : `Удалить категорию "${category.name}"?`;

    if (confirm(message)) {
        storageInstance.deleteCategory(id);
        renderCategories();
        showToast('Категория удалена', 'success');
    }
}

function isLightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
}