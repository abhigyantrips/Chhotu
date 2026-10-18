export function localDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function epochFromLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  const epoch = Math.floor(date.getTime()/1000);
  // Reject invalid calendar dates and times skipped by daylight saving changes.
  if (localDateTime(date) !== (value.length === 16 ? value + ':00' : value)) return null;
  return /^\d{10}$/.test(String(epoch)) ? epoch : null;
}
export function slugify(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,80).replace(/-$/, '');
}
