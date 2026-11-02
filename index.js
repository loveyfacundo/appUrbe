const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => {
    res.send('Bienvenido a Urbe, la mejor plataforma de viajes');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en ${HOST}:${PORT}`);
});
