const crypto = require('node:crypto');

class RepositorioIdentidadMemoria {
  constructor() {
    this.usuarios = new Map();
  }

  async guardar(usuario) {
    this.usuarios.set(usuario.email.toLowerCase(), usuario);
    return usuario;
  }

  async buscarPorEmail(email) {
    return this.usuarios.get(String(email).toLowerCase()) || null;
  }

  async buscarPorId(id) {
    return [...this.usuarios.values()].find((usuario) => usuario.id === id) || null;
  }
}

class RepositorioIdentidadPostgres {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('RepositorioIdentidadPostgres requiere un pool PostgreSQL');
    }
    this.pool = pool;
  }

  async guardar(usuario) {
    const resultado = await this.pool.query(
      `INSERT INTO usuarios
        (id, email, nombre, password_hash, activo, rol, permisos)
       VALUES ($1, $2, $3, $4, TRUE, $5, $6)
       RETURNING id, email, nombre, password_hash, activo, rol, permisos`,
      [
        usuario.id,
        usuario.email,
        usuario.name,
        usuario.passwordHash,
        usuario.role,
        usuario.permissions
      ]
    );
    return convertirUsuario(resultado.rows[0]);
  }

  async guardarAdministradorInicial(usuario) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        "SELECT pg_advisory_xact_lock(hashtext('appurbe:identity-bootstrap-admin'))"
      );
      const existente = await cliente.query(
        "SELECT 1 FROM usuarios WHERE rol = 'administrador' LIMIT 1"
      );
      if (existente.rowCount > 0) {
        const error = new Error('El administrador inicial ya fue creado');
        error.code = 'ADMIN_BOOTSTRAP_COMPLETE';
        throw error;
      }
      const resultado = await cliente.query(
        `INSERT INTO usuarios
          (id, email, nombre, password_hash, activo, rol, permisos)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6)
         RETURNING id, email, nombre, password_hash, activo, rol, permisos`,
        [
          usuario.id,
          usuario.email,
          usuario.name,
          usuario.passwordHash,
          usuario.role,
          usuario.permissions
        ]
      );
      await cliente.query('COMMIT');
      return convertirUsuario(resultado.rows[0]);
    } catch (error) {
      try {
        await cliente.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    } finally {
      cliente.release();
    }
  }

  async buscarPorEmail(email) {
    const resultado = await this.pool.query(
      `SELECT id, email, nombre, password_hash, activo, rol, permisos
         FROM usuarios
        WHERE email = $1`,
      [String(email).trim().toLowerCase()]
    );
    return convertirUsuario(resultado.rows[0]);
  }

  async buscarPorId(id) {
    const resultado = await this.pool.query(
      `SELECT id, email, nombre, password_hash, activo, rol, permisos
         FROM usuarios
        WHERE id = $1`,
      [id]
    );
    return convertirUsuario(resultado.rows[0]);
  }
}

function convertirUsuario(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    email: fila.email,
    name: fila.nombre,
    passwordHash: fila.password_hash,
    active: fila.activo,
    role: fila.rol,
    permissions: fila.permisos || []
  };
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verificarPassword(password, passwordHash) {
  if (!passwordHash?.startsWith('scrypt:')) return false;
  const [, salt, hash] = passwordHash.split(':');
  const calculado = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculado, 'hex'));
}

module.exports = {
  RepositorioIdentidadMemoria,
  RepositorioIdentidadPostgres,
  hashPassword,
  verificarPassword
};
