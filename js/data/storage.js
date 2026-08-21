import { DEFAULT_CATEGORIES } from '../config/constants.js';

export class Storage {
    constructor() {
        this.dbName = 'budgetApp';
        this.initDB();
    }

    initDB() {
        let data = localStorage.getItem(this.dbName);
        
        if (!data) {
            const initialData = {
                transactions: [],
                categories: DEFAULT_CATEGORIES,
                settings: {
                    currency: 'RUB',
                    theme: 'light'
                },
                debts: []
            };
            localStorage.setItem(this.dbName, JSON.stringify(initialData));
            return;
        }
        
        this.migrateData();
    }

    migrateData() {
        const data = this.getData();
        let needsUpdate = false;

        if (!data.version) {
            const oldData = data;
            const newData = {
                version: 6,
                expenseCategories: [],
                incomeCategories: [],
                debtCategories: [],
                transactions: oldData.transactions || [],
                debts: oldData.debts || []
            };

            if (oldData.categories) {
                const incomeCats = oldData.categories.filter(c => c.type === 'income');
                const expenseCats = oldData.categories.filter(c => c.type === 'expense');

                const incomeMap = {};
                const expenseMap = {};

                incomeCats.forEach(cat => {
                    if (!cat.parentId) {
                        const newCat = {
                            id: cat.id,
                            name: cat.name,
                            subcategories: []
                        };
                        incomeMap[cat.id] = newCat;
                        newData.incomeCategories.push(newCat);
                    }
                });

                expenseCats.forEach(cat => {
                    if (!cat.parentId) {
                        const newCat = {
                            id: cat.id,
                            name: cat.name,
                            subcategories: []
                        };
                        expenseMap[cat.id] = newCat;
                        newData.expenseCategories.push(newCat);
                    }
                });

                incomeCats.forEach(cat => {
                    if (cat.parentId && incomeMap[cat.parentId]) {
                        incomeMap[cat.parentId].subcategories.push({
                            id: cat.id,
                            name: cat.name
                        });
                    }
                });

                expenseCats.forEach(cat => {
                    if (cat.parentId && expenseMap[cat.parentId]) {
                        expenseMap[cat.parentId].subcategories.push({
                            id: cat.id,
                            name: cat.name
                        });
                    }
                });

                newData.transactions = oldData.transactions.map(t => {
                    const newT = { ...t };
                    if (t.type === 'income') {
                        newT.incomeCategoryId = t.category || '';
                        newT.incomeCategoryName = t.categoryName || '';
                        delete newT.category;
                        delete newT.categoryName;
                        delete newT.subcategoryId;
                        delete newT.subcategoryName;
                    } else {
                        const cat = expenseCats.find(c => c.id === t.category);
                        if (cat) {
                            newT.categoryId = cat.parentId || cat.id;
                            newT.categoryName = cat.parentId ? 
                                (expenseMap[cat.parentId]?.name || '') : cat.name;
                            if (cat.parentId) {
                                newT.subcategoryId = cat.id;
                                newT.subcategoryName = cat.name;
                            } else {
                                newT.subcategoryId = '';
                                newT.subcategoryName = '';
                            }
                        }
                        delete newT.category;
                        delete newT.categoryName;
                    }
                    newT.photo = t.photo || '';
                    newT.isDebtPayment = t.isDebtPayment || false;
                    return newT;
                });
            }

            needsUpdate = true;
            localStorage.setItem(this.dbName, JSON.stringify(newData));
        }

        const currentData = this.getData();
        let hasPhotoField = true;
        if (currentData.transactions && currentData.transactions.length > 0) {
            hasPhotoField = currentData.transactions.some(t => t.photo !== undefined);
        }
        if (!hasPhotoField && currentData.transactions) {
            currentData.transactions = currentData.transactions.map(t => ({
                ...t,
                photo: t.photo || '',
                isDebtPayment: t.isDebtPayment || false
            }));
            needsUpdate = true;
        }

        if (!currentData.debts) {
            currentData.debts = [];
            needsUpdate = true;
        }

        if (needsUpdate) {
            this.saveData(currentData);
        }
    }

    getData() {
        return JSON.parse(localStorage.getItem(this.dbName));
    }

    saveData(data) {
        localStorage.setItem(this.dbName, JSON.stringify(data));
    }

    getTransactions() {
        const data = this.getData();
        console.log('getTransactions - все транзакции:', data.transactions);
        return data.transactions || [];
    }

    getTransaction(id) {
        return this.getTransactions().find(t => t.id === id);
    }

    addTransaction(transaction) {
        const data = this.getData();
        const normalizedTransaction = {
            ...transaction,
            id: transaction.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            amount: Number(transaction.amount || 0),
            date: transaction.date || new Date().toISOString().split('T')[0],
            photo: transaction.photo || '',
            isDebtPayment: Boolean(transaction.isDebtPayment)
        };
        data.transactions = Array.isArray(data.transactions) ? data.transactions : [];
        data.transactions.push(normalizedTransaction);
        this.saveData(data);
        return normalizedTransaction;
    }

    recordDebtPayment(debtId, payment) {
        const data = this.getData();
        data.transactions = Array.isArray(data.transactions) ? data.transactions : [];
        data.debts = Array.isArray(data.debts) ? data.debts : [];

        const debtIndex = data.debts.findIndex(debt => debt.id === debtId);
        if (debtIndex === -1) {
            throw new Error('Долг не найден');
        }

        const debt = data.debts[debtIndex];
        const debtAmount = Number(debt.amount || 0);
        const alreadyPaid = Number(debt.paidAmount || 0);
        const remaining = Math.max(debtAmount - alreadyPaid, 0);
        const payAmount = Number(payment.amount || 0);

        if (!Number.isFinite(payAmount) || payAmount <= 0 || payAmount > remaining) {
            throw new Error('Некорректная сумма погашения');
        }

        const transaction = {
            ...payment,
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'expense',
            amount: payAmount,
            date: payment.date || new Date().toISOString().split('T')[0],
            photo: payment.photo || '',
            isDebtPayment: true,
            debtId: debt.id,
            debtTitle: debt.title
        };

        data.transactions.push(transaction);
        debt.paidAmount = Math.min(alreadyPaid + payAmount, debtAmount);
        debt.transactionIds = Array.isArray(debt.transactionIds) ? debt.transactionIds : [];
        debt.transactionIds.push(transaction.id);
        data.debts[debtIndex] = debt;

        // Долг и связанная расходная транзакция сохраняются одним действием.
        // Благодаря этому страницы «Главная» и «Транзакции» читают один и тот же результат.
        this.saveData(data);
        return { transaction, debt };
    }

    updateTransaction(id, updatedData) {
        const data = this.getData();
        const index = data.transactions.findIndex(t => t.id === id);
        if (index !== -1) {
            data.transactions[index] = { ...data.transactions[index], ...updatedData };
            this.saveData(data);
            return data.transactions[index];
        }
        return null;
    }

    deleteTransaction(id) {
        const data = this.getData();
        data.transactions = data.transactions.filter(t => t.id !== id);
        this.saveData(data);
    }

    getBalance() {
        const transactions = this.getTransactions();
        return transactions.reduce((acc, t) => {
            return t.type === 'income' ? acc + t.amount : acc - t.amount;
        }, 0);
    }

    getTotalByType(type) {
        const transactions = this.getTransactions();
        return transactions
            .filter(t => t.type === type)
            .reduce((acc, t) => acc + t.amount, 0);
    }

    getCategories() {
        const data = this.getData();
        if (data.categories) {
            return data.categories;
        }
        const result = [];
        if (data.incomeCategories) {
            data.incomeCategories.forEach(cat => {
                result.push({
                    id: cat.id,
                    name: cat.name,
                    icon: '◻',
                    color: '#3B82F6',
                    type: 'income',
                    parentId: null
                });
                if (cat.subcategories) {
                    cat.subcategories.forEach(sub => {
                        result.push({
                            id: sub.id,
                            name: sub.name,
                            icon: '◻',
                            color: '#3B82F6',
                            type: 'income',
                            parentId: cat.id
                        });
                    });
                }
            });
        }
        if (data.expenseCategories) {
            data.expenseCategories.forEach(cat => {
                result.push({
                    id: cat.id,
                    name: cat.name,
                    icon: '◻',
                    color: '#EF4444',
                    type: 'expense',
                    parentId: null
                });
                if (cat.subcategories) {
                    cat.subcategories.forEach(sub => {
                        result.push({
                            id: sub.id,
                            name: sub.name,
                            icon: '◻',
                            color: '#EF4444',
                            type: 'expense',
                            parentId: cat.id
                        });
                    });
                }
            });
        }
        return result;
    }

    getCategory(id) {
        return this.getCategories().find(c => c.id === id);
    }

    getCategoriesByType(type) {
        return this.getCategories().filter(c => c.type === type);
    }

    getMainCategories(type) {
        return this.getCategories().filter(c => c.type === type && !c.parentId);
    }

    getSubCategories(parentId) {
        return this.getCategories().filter(c => c.parentId === parentId);
    }

    getCategoryTree(type) {
        const mainCategories = this.getMainCategories(type);
        return mainCategories.map(cat => ({
            ...cat,
            children: this.getSubCategories(cat.id)
        }));
    }

    addCategory(category) {
        const data = this.getData();
        category.id = category.id || Date.now().toString();
        category.color = category.color || '#666666';
        if (!data.categories) {
            data.categories = this.getCategories();
        }
        data.categories.push(category);
        this.saveData(data);
        return category;
    }

    updateCategory(id, updatedData) {
        const data = this.getData();
        if (!data.categories) {
            data.categories = this.getCategories();
        }
        const index = data.categories.findIndex(c => c.id === id);
        if (index !== -1) {
            data.categories[index] = { ...data.categories[index], ...updatedData };
            this.saveData(data);
            return data.categories[index];
        }
        return null;
    }

    deleteCategory(id) {
        const data = this.getData();
        if (!data.categories) {
            data.categories = this.getCategories();
        }
        
        const subCategories = data.categories.filter(c => c.parentId === id);
        const allIds = [id, ...subCategories.map(c => c.id)];
        
        const hasTransactions = data.transactions.some(t => allIds.includes(t.category));
        
        if (hasTransactions) {
            let defaultCat = data.categories.find(c => c.id === 'uncategorized');
            if (!defaultCat) {
                defaultCat = {
                    id: 'uncategorized',
                    name: 'Без категории',
                    icon: '◻',
                    color: '#666666',
                    type: 'expense',
                    parentId: null
                };
                data.categories.push(defaultCat);
            }
            
            data.transactions = data.transactions.map(t => {
                if (allIds.includes(t.category)) {
                    return {
                        ...t,
                        category: 'uncategorized',
                        categoryName: 'Без категории'
                    };
                }
                return t;
            });
        }
        
        data.categories = data.categories.filter(c => !allIds.includes(c.id));
        this.saveData(data);
    }

    getSettings() {
        return this.getData().settings || {};
    }

    updateSettings(settings) {
        const data = this.getData();
        data.settings = { ...data.settings, ...settings };
        this.saveData(data);
    }
}