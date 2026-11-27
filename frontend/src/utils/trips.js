export const EMPTY_LOCATION = { latitude: '', longitude: '', address: '' };
export const TRIP_STEPS = [
  ['REQUESTED', 'Solicitado'],
  ['ASSIGNED', 'Chofer asignado'],
  ['DRIVER_ARRIVING', 'En camino'],
  ['IN_PROGRESS', 'En viaje'],
  ['COMPLETED', 'Finalizado']
];
export const TERMINAL_STATUSES = new Set([
  'COMPLETED', 'NO_DRIVERS_AVAILABLE', 'CANCELLED', 'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER', 'CANCELLED_BY_OPERATOR'
]);

export function money(amount, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);
}

export function dateLabel(value) {
  if (!value) return 'Reci?n';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function statusLabel(status) {
  return ({
    REQUESTED: 'Buscando chofer',
    DISPATCHING: 'Buscando chofer',
    ASSIGNED: 'Chofer asignado',
    DRIVER_ARRIVING: 'Chofer en camino',
    IN_PROGRESS: 'Viaje en curso',
    COMPLETED: 'Viaje finalizado',
    NO_DRIVERS_AVAILABLE: 'Sin choferes disponibles',
    CANCELLED: 'Cancelado',
    CANCELLED_BY_PASSENGER: 'Cancelado por pasajero',
    CANCELLED_BY_DRIVER: 'Cancelado por chofer',
    CANCELLED_BY_OPERATOR: 'Cancelado por operador'
  })[status] || 'Estado actualizado';
}

export function statusTone(status) {
  if (['REQUESTED', 'DISPATCHING'].includes(status)) return 'waiting';
  if (['NO_DRIVERS_AVAILABLE', 'CANCELLED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER'].includes(status)) return 'error';
  return 'active';
}
