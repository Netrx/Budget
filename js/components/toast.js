// ===== УВЕДОМЛЕНИЯ =====
let toastTimeout = null;

export function showToast(message, type = 'info') {
    const existingToast = document.querySelector('.toast-container');
    if (existingToast) {
        existingToast.remove();
    }
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    const colors = {
        success: isDark ? '#22C55E' : '#000000',
        error: isDark ? '#EF4444' : '#000000',
        warning: isDark ? '#F59E0B' : '#000000',
        info: isDark ? '#FFFFFF' : '#666666'
    };
    
    const toast = document.createElement('div');
    toast.className = 'toast-container';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-bg-card);
        padding: 10px 24px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-md);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 2000;
        animation: fadeIn 0.2s ease;
        font-family: var(--font-family);
        font-size: var(--font-size-sm);
        color: var(--color-text);
        max-width: 90%;
    `;
    
    toast.innerHTML = `
        <span style="font-size:14px;color:${colors[type] || colors.info};">${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        toast.style.transition = '0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}