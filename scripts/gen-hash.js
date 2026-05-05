const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('Admin1234!', 10);
console.log(hash);
