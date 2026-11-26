Vigencia de una cotización previa: 5 minutos.

La cotización y el cobro final se calculan exclusivamente en el servidor con
la misma función `calcularTarifa`. El cliente nunca envía ni determina el
monto: al finalizar, el servicio aplica esa función a la distancia y duración
reales que recibió para el viaje, y valida nuevamente los límites.

Parámetros actuales:

- Tarifa base: 500 ARS.
- Valor por kilómetro: 200 ARS.
- Valor por minuto: 30 ARS.
- Distancia máxima: 100 km.

La estimación puede diferir del monto final porque se basa en la distancia
geodésica entre las coordenadas y un tiempo estimado; el cobro usa la distancia
y el tiempo medidos durante el recorrido. La distancia cero cobra la tarifa
base, y cualquier distancia superior a 100 km se rechaza.
