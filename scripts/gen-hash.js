// Gera um hash bcrypt para uma password. Uso:
//   node scripts/gen-hash.js "a-password-aqui"
//
// A password vem da linha de comandos de propósito: estava escrita aqui
// dentro, e era a terceira cópia em claro da mesma credencial no repositório.
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Falta a password. Uso: node scripts/gen-hash.js "a-password"');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
