// ===== КОМПОНЕНТ: ВЫБОР ЦВЕТА (COLOR WHEEL) =====

export function createColorPicker(containerId, selectedColor = '#3B82F6', onColorSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const hue = hexToHue(selectedColor);
    let currentHue = hue;
    let currentSaturation = 100;
    let currentLightness = 50;
    
    container.innerHTML = `
        <div class="color-picker-wrapper">
            <div class="color-wheel-container">
                <canvas id="color-wheel" width="280" height="280"></canvas>
                <div id="color-selector-dot"></div>
            </div>
            <div class="color-slider-container">
                <div id="color-slider-indicator"></div>
            </div>
            <div class="color-info">
                <div id="color-preview"></div>
                <input type="text" id="color-hex-input" value="${selectedColor}">
            </div>
            <div class="quick-colors-grid">
                ${getQuickColors().map(color => `
                    <div class="quick-color ${color === selectedColor ? 'active' : ''}" data-color="${color}"></div>
                `).join('')}
            </div>
            <input type="hidden" id="selected-color-value" value="${selectedColor}">
        </div>
    `;
    
    const canvas = document.getElementById('color-wheel');
    const ctx = canvas.getContext('2d');
    const dot = document.getElementById('color-selector-dot');
    const slider = document.getElementById('color-slider-indicator');
    const sliderContainer = document.querySelector('.color-slider-container');
    const preview = document.getElementById('color-preview');
    const hexInput = document.getElementById('color-hex-input');
    const hiddenInput = document.getElementById('selected-color-value');
    
    let isDraggingWheel = false;
    let isDraggingSlider = false;
    
    function drawColorWheel() {
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = width / 2 - 10;
        
        ctx.clearRect(0, 0, width, height);
        
        for (let angle = 0; angle < 360; angle++) {
            const startAngle = (angle - 0.5) * Math.PI / 180;
            const endAngle = (angle + 0.5) * Math.PI / 180;
            
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            
            ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
            ctx.fill();
        }
        
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        
        const gradient2 = ctx.createRadialGradient(centerX, centerY, radius * 0.3, centerX, centerY, radius);
        gradient2.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient2.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = gradient2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    function getColorFromWheel(x, y) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const canvasX = (x - rect.left) * scaleX;
        const canvasY = (y - rect.top) * scaleY;
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = canvas.width / 2 - 10;
        
        const dx = canvasX - centerX;
        const dy = canvasY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > radius) return null;
        
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle < 0) angle += 360;
        
        const saturation = Math.min(distance / radius * 100, 100);
        const lightness = 50;
        
        return { hue: angle, saturation, lightness };
    }
    
    function updateColor(hue, saturation, lightness) {
        const color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        const hex = hslToHex(hue, saturation, lightness);
        
        preview.style.background = color;
        hexInput.value = hex.toUpperCase();
        hiddenInput.value = hex.toUpperCase();
        
        sliderContainer.style.background = `linear-gradient(to right, 
            hsl(${hue}, 0%, 50%), 
            hsl(${hue}, 100%, 50%)
        )`;
        
        const angle = (hue - 90) * Math.PI / 180;
        const radius = (canvas.width / 2 - 10) * (saturation / 100);
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const dotX = centerX + Math.cos(angle) * radius;
        const dotY = centerY + Math.sin(angle) * radius;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        
        dot.style.display = 'block';
        dot.style.left = (dotX * scaleX + rect.left) + 'px';
        dot.style.top = (dotY * scaleY + rect.top) + 'px';
        
        const sliderRect = sliderContainer.getBoundingClientRect();
        const sliderPos = (saturation / 100) * sliderRect.width;
        slider.style.left = (sliderPos + sliderRect.left) + 'px';
        
        if (onColorSelect) {
            onColorSelect(hex.toUpperCase());
        }
    }
    
    function hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
        
        const toHex = x => {
            const hex = Math.round(255 * f(x)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        
        return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
    }
    
    function hexToHue(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        
        if (max !== min) {
            if (max === r) {
                h = (g - b) / (max - min) * 60;
            } else if (max === g) {
                h = 120 + (r - b) / (max - min) * 60;
            } else {
                h = 240 + (r - g) / (max - min) * 60;
            }
            if (h < 0) h += 360;
        }
        
        return h;
    }
    
    function getQuickColors() {
        return [
            '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
            '#EF4444', '#F59E0B', '#EAB308', '#22C55E', '#10B981',
            '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
            '#EC4899', '#F43F5E'
        ];
    }
    
    function handleWheelClick(e) {
        const color = getColorFromWheel(e.clientX, e.clientY);
        if (color) {
            currentHue = color.hue;
            currentSaturation = color.saturation;
            currentLightness = color.lightness;
            updateColor(currentHue, currentSaturation, currentLightness);
        }
    }
    
    function handleWheelMove(e) {
        if (isDraggingWheel) {
            const color = getColorFromWheel(e.clientX, e.clientY);
            if (color) {
                currentHue = color.hue;
                currentSaturation = color.saturation;
                currentLightness = color.lightness;
                updateColor(currentHue, currentSaturation, currentLightness);
            }
        }
    }
    
    function handleSliderClick(e) {
        const rect = sliderContainer.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const saturation = (x / rect.width) * 100;
        currentSaturation = saturation;
        updateColor(currentHue, currentSaturation, currentLightness);
    }
    
    function handleSliderMove(e) {
        if (isDraggingSlider) {
            const rect = sliderContainer.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const saturation = (x / rect.width) * 100;
            currentSaturation = saturation;
            updateColor(currentHue, currentSaturation, currentLightness);
        }
    }
    
    canvas.addEventListener('mousedown', (e) => {
        isDraggingWheel = true;
        handleWheelClick(e);
    });
    
    document.addEventListener('mousemove', handleWheelMove);
    document.addEventListener('mouseup', () => {
        isDraggingWheel = false;
    });
    
    sliderContainer.addEventListener('mousedown', (e) => {
        isDraggingSlider = true;
        handleSliderClick(e);
    });
    
    document.addEventListener('mousemove', handleSliderMove);
    document.addEventListener('mouseup', () => {
        isDraggingSlider = false;
    });
    
    hexInput.addEventListener('input', (e) => {
        let value = e.target.value.trim();
        if (value.startsWith('#')) {
            if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
                const hue = hexToHue(value);
                currentHue = hue;
                currentSaturation = 100;
                currentLightness = 50;
                updateColor(currentHue, currentSaturation, currentLightness);
            }
        }
    });
    
    document.querySelectorAll('.quick-color').forEach(el => {
        el.addEventListener('click', () => {
            const color = el.dataset.color;
            const hue = hexToHue(color);
            currentHue = hue;
            currentSaturation = 100;
            currentLightness = 50;
            updateColor(currentHue, currentSaturation, currentLightness);
            
            document.querySelectorAll('.quick-color').forEach(c => {
                c.classList.remove('active');
            });
            el.classList.add('active');
        });
    });
    
    drawColorWheel();
    
    const initialHue = hexToHue(selectedColor);
    currentHue = initialHue;
    currentSaturation = 100;
    currentLightness = 50;
    updateColor(currentHue, currentSaturation, currentLightness);
    
    return {
        getColor: () => hiddenInput.value,
        setColor: (color) => {
            const hue = hexToHue(color);
            currentHue = hue;
            currentSaturation = 100;
            currentLightness = 50;
            updateColor(currentHue, currentSaturation, currentLightness);
        }
    };
}