export const PRIORITY_SLA_HOURS = {
  Hög: 24,
  Medel: 72,
  Låg: 120,
};

export const PRIORITY_WEIGHT = {
  Hög: 3,
  Medel: 2,
  Låg: 1,
};

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const hoursFormatter = new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return 'Okänt datum';
  }
  return dateFormatter.format(value);
}

export function formatHours(value) {
  const absValue = Math.abs(value);
  return `${hoursFormatter.format(absValue)} h`;
}

export function hoursBetween(startMs, endMs) {
  return (endMs - startMs) / (1000 * 60 * 60);
}
