# Ofertas de asignación

Cada oferta expira en el servidor aunque el cliente del conductor se desconecte.
El vencimiento consulta al siguiente candidato y, cuando no quedan candidatos,
deja el viaje en `NO_DRIVERS_AVAILABLE`.

El plazo se configura con `OFFER_TTL_SECONDS`, que acepta valores enteros de
15 a 30 segundos. El valor predeterminado es 20 segundos. Los valores fuera del
rango se rechazan al crear el gestor de ofertas.
