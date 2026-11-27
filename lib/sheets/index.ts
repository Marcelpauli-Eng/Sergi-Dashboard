/**
 * Todo lo que habla con Google Sheets. Ver cada archivo de esta carpeta.
 */
export { ErrorQuotaGoogle, listSheetTabs, puedeEscribir } from "./api";
export type { SheetDoc } from "./api";
export { origenPrincipal, origensFixos, origens, origenDe } from "./bosses";
export type { Origen } from "./bosses";
export { readSheet, ensureManagedColumns, writeDeliveries, crearComanda, actualitzarComanda, moureComandes, esborrarComanda, restaurarComanda, cacheCoordinates } from "./comandes";
export type { SheetSnapshot, WriteResult, NovaComanda, LlocGuardat, DadesComanda, CoordCacheada } from "./comandes";
export { TAB_FACTURAS, readFacturas, emitirFactura, actualizarEstadoFactura, canviarDataFactura, esborrarFactura } from "./factures";
export { readClients, writeClients, readEmissor, writeEmissor } from "./facturacio";
export { readImportes, writeImportes } from "./imports";
