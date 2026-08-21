export const TRANSACTION_TYPES = {
    INCOME: 'income',
    EXPENSE: 'expense'
};

export const CATEGORY_TYPES = {
    INCOME: 'income',
    EXPENSE: 'expense'
};

// Иконки для категорий (только геометрические символы)
export const CATEGORY_ICONS = [
    { value: '◻', label: 'Пустой квадрат' },
    { value: '◼', label: 'Залитый квадрат' },
    { value: '▣', label: 'Квадрат с контуром' },
    { value: '▢', label: 'Квадрат с точкой' },
    { value: '◆', label: 'Залитый ромб' },
    { value: '◇', label: 'Пустой ромб' },
    { value: '●', label: 'Залитый круг' },
    { value: '○', label: 'Пустой круг' },
    { value: '▲', label: 'Залитый треугольник' },
    { value: '△', label: 'Пустой треугольник' },
    { value: '★', label: 'Залитая звезда' },
    { value: '☆', label: 'Пустая звезда' },
    { value: '✦', label: 'Залитый ромб со звездой' },
    { value: '✧', label: 'Пустой ромб со звездой' },
    { value: '⊞', label: 'Квадрат с плюсом' },
    { value: '⊟', label: 'Квадрат с минусом' },
    { value: '⬡', label: 'Шестиугольник' },
    { value: '▤', label: 'Квадрат с диагональю' },
    { value: '▥', label: 'Квадрат с диагоналями' },
    { value: '▦', label: 'Сетка' }
];

// Цвета для категорий (градиентные круги)
export const CATEGORY_COLORS = [
    { value: '#000000', label: 'Черный' },
    { value: '#333333', label: 'Темно-серый' },
    { value: '#666666', label: 'Серый' },
    { value: '#999999', label: 'Светло-серый' },
    { value: '#CCCCCC', label: 'Очень светлый' },
    { value: '#EF4444', label: 'Красный' },
    { value: '#F59E0B', label: 'Оранжевый' },
    { value: '#F97316', label: 'Ярко-оранжевый' },
    { value: '#EAB308', label: 'Желтый' },
    { value: '#22C55E', label: 'Зеленый' },
    { value: '#10B981', label: 'Изумрудный' },
    { value: '#14B8A6', label: 'Бирюзовый' },
    { value: '#06B6D4', label: 'Голубой' },
    { value: '#3B82F6', label: 'Синий' },
    { value: '#6366F1', label: 'Индиго' },
    { value: '#8B5CF6', label: 'Фиолетовый' },
    { value: '#A855F7', label: 'Пурпурный' },
    { value: '#D946EF', label: 'Розовый' },
    { value: '#EC4899', label: 'Ярко-розовый' },
    { value: '#F43F5E', label: 'Малиновый' }
];

// Градиентные цвета для категорий (светлый к темному)
export const CATEGORY_GRADIENT_COLORS = [
    { value: 'linear-gradient(135deg, #666666, #000000)', label: 'Черный градиент' },
    { value: 'linear-gradient(135deg, #999999, #333333)', label: 'Серый градиент' },
    { value: 'linear-gradient(135deg, #FCA5A5, #EF4444)', label: 'Красный градиент' },
    { value: 'linear-gradient(135deg, #FCD34D, #F59E0B)', label: 'Оранжевый градиент' },
    { value: 'linear-gradient(135deg, #FDE047, #EAB308)', label: 'Желтый градиент' },
    { value: 'linear-gradient(135deg, #86EFAC, #22C55E)', label: 'Зеленый градиент' },
    { value: 'linear-gradient(135deg, #6EE7B7, #10B981)', label: 'Изумрудный градиент' },
    { value: 'linear-gradient(135deg, #67E8F9, #06B6D4)', label: 'Голубой градиент' },
    { value: 'linear-gradient(135deg, #93C5FD, #3B82F6)', label: 'Синий градиент' },
    { value: 'linear-gradient(135deg, #A5B4FC, #6366F1)', label: 'Индиго градиент' },
    { value: 'linear-gradient(135deg, #C4B5FD, #8B5CF6)', label: 'Фиолетовый градиент' },
    { value: 'linear-gradient(135deg, #D8B4FE, #A855F7)', label: 'Пурпурный градиент' },
    { value: 'linear-gradient(135deg, #F9A8D4, #EC4899)', label: 'Розовый градиент' },
    { value: 'linear-gradient(135deg, #FDA4AF, #F43F5E)', label: 'Малиновый градиент' }
];

export const DEFAULT_CATEGORIES = [
    // Категории доходов
    { id: 'salary', name: 'Зарплата', icon: '▣', color: '#3B82F6', type: 'income', parentId: null },
    { id: 'freelance', name: 'Фриланс', icon: '✦', color: '#8B5CF6', type: 'income', parentId: null },
    { id: 'investments', name: 'Инвестиции', icon: '◆', color: '#10B981', type: 'income', parentId: null },
    { id: 'gifts', name: 'Подарки', icon: '★', color: '#F59E0B', type: 'income', parentId: null },
    { id: 'other_income', name: 'Прочее', icon: '◻', color: '#666666', type: 'income', parentId: null },
    
    // Подкатегории доходов
    { id: 'salary_main', name: 'Основная', icon: '▣', color: '#3B82F6', type: 'income', parentId: 'salary' },
    { id: 'salary_bonus', name: 'Бонусы', icon: '★', color: '#6366F1', type: 'income', parentId: 'salary' },
    { id: 'freelance_design', name: 'Дизайн', icon: '✦', color: '#8B5CF6', type: 'income', parentId: 'freelance' },
    { id: 'freelance_dev', name: 'Разработка', icon: '⊞', color: '#A855F7', type: 'income', parentId: 'freelance' },
    { id: 'investments_stocks', name: 'Акции', icon: '◆', color: '#10B981', type: 'income', parentId: 'investments' },
    { id: 'investments_crypto', name: 'Криптовалюта', icon: '⬡', color: '#14B8A6', type: 'income', parentId: 'investments' },
    
    // Категории расходов
    { id: 'food', name: 'Еда', icon: '◻', color: '#EF4444', type: 'expense', parentId: null },
    { id: 'transport', name: 'Транспорт', icon: '◆', color: '#F59E0B', type: 'expense', parentId: null },
    { id: 'entertainment', name: 'Развлечения', icon: '★', color: '#EC4899', type: 'expense', parentId: null },
    { id: 'shopping', name: 'Покупки', icon: '●', color: '#F97316', type: 'expense', parentId: null },
    { id: 'bills', name: 'Счета', icon: '▦', color: '#06B6D4', type: 'expense', parentId: null },
    { id: 'health', name: 'Здоровье', icon: '▲', color: '#22C55E', type: 'expense', parentId: null },
    { id: 'other_expense', name: 'Прочее', icon: '◼', color: '#666666', type: 'expense', parentId: null },
    
    // Подкатегории расходов
    { id: 'food_home', name: 'Домашняя еда', icon: '◻', color: '#EF4444', type: 'expense', parentId: 'food' },
    { id: 'food_cafe', name: 'Кафе и рестораны', icon: '★', color: '#F43F5E', type: 'expense', parentId: 'food' },
    { id: 'food_delivery', name: 'Доставка', icon: '⊞', color: '#F97316', type: 'expense', parentId: 'food' },
    { id: 'transport_bus', name: 'Общественный', icon: '◆', color: '#F59E0B', type: 'expense', parentId: 'transport' },
    { id: 'transport_taxi', name: 'Такси', icon: '◇', color: '#EAB308', type: 'expense', parentId: 'transport' },
    { id: 'transport_fuel', name: 'Топливо', icon: '●', color: '#F97316', type: 'expense', parentId: 'transport' },
    { id: 'transport_maintenance', name: 'Обслуживание', icon: '▣', color: '#EF4444', type: 'expense', parentId: 'transport' },
    { id: 'entertainment_movies', name: 'Кино', icon: '☆', color: '#EC4899', type: 'expense', parentId: 'entertainment' },
    { id: 'entertainment_games', name: 'Игры', icon: '✦', color: '#D946EF', type: 'expense', parentId: 'entertainment' },
    { id: 'entertainment_hobbies', name: 'Хобби', icon: '◻', color: '#A855F7', type: 'expense', parentId: 'entertainment' },
    { id: 'shopping_clothes', name: 'Одежда', icon: '●', color: '#F97316', type: 'expense', parentId: 'shopping' },
    { id: 'shopping_electronics', name: 'Электроника', icon: '▣', color: '#F59E0B', type: 'expense', parentId: 'shopping' },
    { id: 'shopping_home', name: 'Для дома', icon: '▦', color: '#EAB308', type: 'expense', parentId: 'shopping' },
    { id: 'bills_utilities', name: 'Коммунальные', icon: '▦', color: '#06B6D4', type: 'expense', parentId: 'bills' },
    { id: 'bills_internet', name: 'Интернет', icon: '⊞', color: '#3B82F6', type: 'expense', parentId: 'bills' },
    { id: 'bills_phone', name: 'Телефон', icon: '◆', color: '#6366F1', type: 'expense', parentId: 'bills' },
    { id: 'health_pharmacy', name: 'Аптека', icon: '▲', color: '#22C55E', type: 'expense', parentId: 'health' },
    { id: 'health_doctors', name: 'Врачи', icon: '△', color: '#10B981', type: 'expense', parentId: 'health' }
];

export const CURRENCIES = {
    RUB: { symbol: '₽', name: 'Рубль' },
    USD: { symbol: '$', name: 'Доллар' },
    EUR: { symbol: '€', name: 'Евро' }
};