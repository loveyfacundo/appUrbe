const crypto = require('node:crypto');

const SECRET_DEFAULT = 'clave-secreta-para-tests-con-longitud-suficiente-123456';

function codificar(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function crearTokenParaTest(sub, extra = {}, secret = SECRET_DEFAULT) {
  const header = codificar({ alg: 'HS256', typ: 'JWT' });
  const payload = codificar({
    sub,
    roles: ['pasajero'],
    exp: Math.floor(Date.now() / 1000) + 60,
    ...extra
  });
  const firma = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${firma}`;
}

module.exports = {
  SECRET_DEFAULT,
  codificar,
  crearTokenParaTest
};
