// ===== ОБЕРТКА ДЛЯ CHART.JS =====
export function createChart(ctx, config) {
    if (!ctx) return null;
    
    try {
        return new Chart(ctx, config);
    } catch (error) {
        console.error('Ошибка создания графика:', error);
        return null;
    }
}

export function destroyChart(chart) {
    if (chart) {
        chart.destroy();
    }
}

export const chartColors = [
    '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6',
    '#EC4899', '#EF4444', '#14B8A6', '#F97316'
];