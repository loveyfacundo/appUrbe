const crypto = require('node:crypto');
const { RepositorioIdentidadMemoria, hashPassword, verificarPassword } = require('./repositorio-identidad');
const {
  ErrorDeValidacion,
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ErrorDeDominio
} = require('../../viajes/src/dominio/errores/errores');

const ROLES = new Set(['pasajero', 'chofer', 'operador', 'administrador']);

function crearToken({ sub, roles, permissions = [], secret, expiresInSeconds = 3600 }) {
  const codificar = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  const header = codificar({ alg: 'HS256', typ: 'JWT' });
  const payload = codificar({
    sub,
    roles,
    permissions,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

class ServicioIdentidad {
  constructor({ repositorio = new RepositorioIdentidadMemoria(), secret }) {
    this.repositorio = repositorio;
    this.secret = secret;
  }

  async registrar({ name, email, password, role = 'pasajero' }) {
    if (!this.secret) throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'La autenticación no está configurada', 503);
    const usuario = this._crearUsuario({ name, email, password, role });
    if (await this.repositorio.buscarPorEmail(email)) throw new ErrorDeDominio('CONFLICT', 'El email ya está registrado', 409);

    try {
      await this.repositorio.guardar(usuario);
    } catch (error) {
      if (error.code === '23505') {
        throw new ErrorDeDominio('CONFLICT', 'El email ya está registrado', 409);
      }
      throw error;
    }
    return this._respuestaSesion(usuario);
  }

  async registrarAdministradorInicial({ name, email, password }) {
    if (!this.secret) throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'La autenticación no está configurada', 503);
    if (typeof this.repositorio.guardarAdministradorInicial !== 'function') {
      throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'El alta inicial requiere persistencia PostgreSQL', 503);
    }
    const usuario = this._crearUsuario({
      name,
      email,
      password,
      role: 'administrador'
    });
    try {
      await this.repositorio.guardarAdministradorInicial(usuario);
    } catch (error) {
      if (error.code === 'ADMIN_BOOTSTRAP_COMPLETE') {
        throw new ErrorDeDominio('CONFLICT', 'El administrador inicial ya fue creado', 409);
      }
      if (error.code === '23505') {
        throw new ErrorDeDominio('CONFLICT', 'El email ya está registrado', 409);
      }
      throw error;
    }
    return this._respuestaSesion(usuario);
  }

  async login({ email, password }) {
    if (!this.secret) throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'La autenticación no está configurada', 503);
    const usuario = await this.repositorio.buscarPorEmail(email);
    if (!usuario || !usuario.active || !verificarPassword(password, usuario.passwordHash)) {
      throw new ErrorDeDominio('UNAUTHORIZED', 'Credenciales inválidas', 401);
    }
    return this._respuestaSesion(usuario);
  }

  async obtenerPorId(id) {
    const usuario = await this.repositorio.buscarPorId(id);
    if (!usuario) throw new RecursoNoEncontrado('El usuario no existe');
    return usuario;
  }

  _respuestaSesion(usuario) {
    if (!this.secret) throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'La autenticación no está configurada', 503);
    const accessToken = crearToken({
      sub: usuario.id,
      roles: [usuario.role],
      permissions: usuario.permissions,
      secret: this.secret
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        id: usuario.id,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role,
        permissions: usuario.permissions
      }
    };
  }

  _crearUsuario({ name, email, password, role }) {
    if (typeof name !== 'string' || name.trim().length < 2) throw new ErrorDeValidacion('name debe tener al menos 2 caracteres');
    if (typeof email !== 'string' || !email.includes('@')) throw new ErrorDeValidacion('email no es válido');
    if (!ROLES.has(role)) throw new ErrorDeValidacion('role no es válido');
    if (typeof password !== 'string' || password.length < 8) throw new ErrorDeValidacion('password debe tener al menos 8 caracteres');

    let passwordHash;
    try {
      passwordHash = hashPassword(password);
    } catch (error) {
      throw new ErrorDeValidacion(error.message);
    }
    return {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      active: true,
      role,
      permissions: role === 'administrador'
        ? ['drivers:enable', 'drivers:disable', 'vehicles:register', 'drivers:read:available']
        : role === 'operador'
          ? ['trips:read', 'trips:cancel', 'drivers:read:available']
          : role === 'chofer'
            ? ['drivers:self', 'drivers:location', 'trips:accept']
            : ['trips:create', 'trips:read', 'trips:cancel']
    };
  }
}

function exigirRol(actor, roles) {
  if (!actor?.roles?.some((role) => roles.includes(role))) {
    throw new OperacionNoPermitida();
  }
}

module.exports = { ServicioIdentidad, crearToken, exigirRol };
