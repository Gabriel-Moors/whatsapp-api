const phoneNumberFormatter = function(number) {
  let formatted = number.replace(/\D/g, '');

  // Verifica se o número começa com zero (prefixo)
  if (formatted.startsWith('0')) {
    // Remove o zero e substitui por "55" se o número tiver 10 dígitos (móvel)
    if (formatted.length === 10) {
      formatted = '55' + formatted.substr(1);
    }
    // Remove o zero e substitui por "55" se o número tiver 11 dígitos (fixo ou móvel)
    else if (formatted.length === 11) {
      formatted = '55' + formatted.substr(1);
    }
  }
  // Adiciona "55" se o número não tiver o DDI e tiver 10 dígitos (móvel)
  else if (formatted.length === 10) {
    formatted = '55' + formatted;
  }
  // Adiciona "55" se o número não tiver o DDI e tiver 11 dígitos (fixo ou móvel)
  else if (formatted.length === 11) {
    formatted = '55' + formatted;
  }

  if (!formatted.endsWith('@c.us')) {
    formatted += '@c.us';
  }

  return formatted;
}

module.exports = {
  phoneNumberFormatter
}
