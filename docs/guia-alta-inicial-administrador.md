# Alta inicial segura de administrador

El endpoint de bootstrap solo crea un administrador cuando la base todavía no
tiene ninguno. La operación se serializa en PostgreSQL, así que solicitudes
concurrentes no pueden crear dos administradores iniciales.

1. Generar dos secretos:

   ```powershell
   $jwtSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
   $bootstrapToken = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

2. Agregar `JWT_SECRET=<jwtSecret>` e
   `IDENTITY_BOOTSTRAP_TOKEN=<bootstrapToken>` al `.env` local. No versionar ni
   compartir ese archivo. Si ya existe, conservar las demás variables.

3. Iniciar o recrear la aplicación:

   ```powershell
   docker compose up -d --build app
   ```

4. Crear el administrador inicial (reemplazar el email y elegir una contraseña
   segura):

   ```powershell
   $headers = @{
     "X-Bootstrap-Token" = $bootstrapToken
     "X-Correlation-Id" = [guid]::NewGuid().ToString()
   }
   $body = @{
     name = "Administrador"
     email = "admin@example.com"
     password = "cambia-esta-clave"
   } | ConvertTo-Json
   Invoke-RestMethod -Method Post `
     -Uri "http://localhost:3000/api/v1/identidad/bootstrap/administrador" `
     -Headers $headers -ContentType "application/json" -Body $body
   ```

   La respuesta contiene la sesión y el token Bearer del administrador. El
   endpoint devuelve `409` si ya existe un administrador, y `401` si el token
   de bootstrap no coincide.

5. Quitar `IDENTITY_BOOTSTRAP_TOKEN` del `.env` y recrear la aplicación:

   ```powershell
   docker compose up -d --force-recreate app
   ```

   Mantener `JWT_SECRET` de forma segura: cambiarlo invalida los tokens
   emitidos previamente. La eliminación de la variable desactiva el endpoint
   de bootstrap; además, la base rechaza el alta inicial después del primer
   administrador.
