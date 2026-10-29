// ===== УТИЛИТЫ ДЛЯ РАБОТЫ С ДАТАМИ =====

/**
 * Форматирует дату в формат: День (цифрой) Месяц (текстом) Год (цифрой)
 * Пример: 17 Августа 2026
 */
export function formatDateToRussian(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = date.getDate();
    const year = date.getFullYear();
    
    const months = [
        'Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
        'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря'
    ];
    
    const month = months[date.getMonth()];
    
    return `${day} ${month} ${year}`;
}

/**
 * Форматирует дату в короткий формат: День.Месяц.Год
 * Пример: 17.08.2026
 */
export function formatDateShort(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}.${month}.${year}`;
}