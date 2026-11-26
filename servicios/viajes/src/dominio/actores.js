function esChofer(actor) {
  return actor?.roles?.some((rol) => rol === 'chofer' || rol === 'conductor') === true;
}

module.exports = { esChofer };
