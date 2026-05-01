// ════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// Brief feedback messages for user actions
// ════════════════════════════════════════════════════════════════════

let toastTimeout = null;

// Show a toast notification
export function showToast(message, type = 'info', duration = 2000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Clear existing toast
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  // Replace container content
  container.innerHTML = '';
  container.appendChild(toast);
  container.classList.add('visible');

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-hide
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      container.classList.remove('visible');
    }, 300);
  }, duration);
}

// Show success toast
export function showSuccess(message, duration = 2000) {
  showToast(message, 'success', duration);
}

// Show error toast
export function showError(message, duration = 2500) {
  showToast(message, 'error', duration);
}

// Show warning toast
export function showWarning(message, duration = 2200) {
  showToast(message, 'warning', duration);
}

// Show info toast
export function showInfo(message, duration = 2000) {
  showToast(message, 'info', duration);
}

// Get icon for toast type
function getIcon(type) {
  switch (type) {
    case 'success': return '✓';
    case 'error': return '✕';
    case 'warning': return '!';
    default: return '◆';
  }
}

// Sourcing-specific toasts
export function showSourcingError(reason) {
  const messages = {
    'wrong-biome': 'Wrong biome — check material requirements',
    'tile-built': 'Tile already has a building',
    'tile-depleted': 'Tile depleted — no more yield',
    'tile-full': 'Tile full — no more dump capacity',
    'water-tile': 'Cannot source from or dump in water',
    'no-active-material': 'Select a material first'
  };
  showError(messages[reason] || reason);
}

export function showSourcingSuccess(material, amount, unit) {
  showSuccess(`Sourced ${amount.toLocaleString()} ${unit} of ${material}`);
}

export function showBuildCommit(buildName) {
  showSuccess(`${buildName} committed — construction started`);
}
