// maskPhone: last 4 digits only — enough to correlate a conversation, not enough to dial.
// maskEmail: first char + *** + @domain — domain alone rarely identifies the person.
function maskPhone(raw) {
  if (!raw) return '(vacío)';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

function maskEmail(raw) {
  if (!raw) return '(vacío)';
  const s = String(raw);
  const at = s.indexOf('@');
  if (at < 0) return '***';
  return `${s[0] || ''}***@${s.slice(at + 1)}`;
}

module.exports = { maskPhone, maskEmail };
