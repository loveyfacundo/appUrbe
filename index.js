const { crearServidor } = require('./servicios/viajes/src/servidor');
const app = crearServidor();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => res.send('Bienvenido a Urbe, la mejor plataforma de viajes'));

app.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en ${HOST}:${PORT}`);
});
