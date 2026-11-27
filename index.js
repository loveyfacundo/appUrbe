const { iniciarTelemetria } = require('./observabilidad/opentelemetry');
const cerrarTelemetria = iniciarTelemetria();
const express = require('express');
const path = require('node:path');
const { crearServidor } = require('./servicios/viajes/src/servidor');
const {
    RETENCION_UBICACION_MS
} = require('./servicios/conductores/src/politica-ubicaciones');
const app = crearServidor();
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => res.status(503).send('El frontend no está compilado. Ejecutá npm run build.'));

let servidor;
let limpiezaUbicaciones;

async function iniciar() {
    await app.locals.modulo?.iniciar?.();
    limpiezaUbicaciones = setInterval(() => {
        app.locals.servicioFlota.limpiarUbicacionesVencidas().catch((error) => {
            console.error('No se pudieron eliminar ubicaciones vencidas', error);
        });
    }, Math.min(5000, RETENCION_UBICACION_MS));
    limpiezaUbicaciones.unref();
    servidor = app.listen(PORT, HOST, () => {
        console.log(`Servidor escuchando en ${HOST}:${PORT}`);
    });
}

async function cerrarGracefully(signal) {
    console.log(`Recibida señal ${signal}, cerrando servidor`);
    if (limpiezaUbicaciones) clearInterval(limpiezaUbicaciones);
    if (!servidor) {
        await app.locals.modulo?.cerrar?.();
        await cerrarTelemetria();
        return;
    }
    servidor.close(async (error) => {
        if (error) {
            console.error('Error al cerrar el servidor', error);
            process.exitCode = 1;
        }
        try {
            await app.locals.modulo?.cerrar?.();
            if (app.locals.verificadorPostgres?.pool !== app.locals.modulo?.pool) {
                await app.locals.verificadorPostgres?.cerrar?.();
            }
            await cerrarTelemetria();
        } catch (closeError) {
            console.error('Error al cerrar recursos', closeError);
            process.exitCode = 1;
        }
        process.exit();
    });
}

process.once('SIGTERM', () => cerrarGracefully('SIGTERM'));
process.once('SIGINT', () => cerrarGracefully('SIGINT'));

iniciar().catch(async (error) => {
    console.error('No se pudo iniciar el servicio', error);
    process.exitCode = 1;
    if (limpiezaUbicaciones) clearInterval(limpiezaUbicaciones);
    try {
        await app.locals.modulo?.cerrar?.();
    } catch (closeError) {
        console.error('No se pudieron cerrar los recursos tras el fallo de inicio', closeError);
    }
    try {
        await cerrarTelemetria();
    } catch (closeError) {
        console.error('No se pudo cerrar OpenTelemetry tras el fallo de inicio', closeError);
    }
});
